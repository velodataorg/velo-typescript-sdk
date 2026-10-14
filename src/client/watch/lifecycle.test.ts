import { describe, expect, it, vi } from "vitest";

import { VeloError } from "../../errors.ts";
import { abnormalCloseEvent } from "../../transport/websocket.ts";
import { WatchLifecycle } from "./lifecycle.ts";
import type { LifecycleEvents, TeardownReason } from "./lifecycle.ts";
import { prepareWatcherOptions } from "./options.ts";

interface Events extends LifecycleEvents {
  readonly item: number;
}

/**
 * A lifecycle whose controller does nothing on its own: each test drives
 * `ready` and `fail` by hand for the attempts `start` hands out.
 */
function harness(options?: { signal?: AbortSignal; start?: (attempt: AbortController) => void }) {
  const attempts: AbortController[] = [];
  const teardowns: TeardownReason[] = [];
  const events: string[] = [];
  const lifecycle = new WatchLifecycle<Events>(
    "Test",
    prepareWatcherOptions(options?.signal ? { signal: options.signal } : undefined),
    {
      start: (attempt) => {
        attempts.push(attempt);
        options?.start?.(attempt);
      },
      teardown: (reason) => teardowns.push(reason),
    },
  );
  lifecycle.emitter.on("error", (error) => events.push(`error:${error.message}`));
  lifecycle.emitter.on("close", (close) => events.push(`close:${close.code}`));
  return { lifecycle, attempts, teardowns, events };
}

describe("WatchLifecycle", () => {
  it("shares one attempt between concurrent connects and opens on ready", async () => {
    const { lifecycle, attempts, teardowns } = harness();

    const first = lifecycle.connect();
    const second = lifecycle.connect();

    expect(first).toBe(second);
    expect(lifecycle.state).toBe("connecting");
    expect(attempts).toHaveLength(1);
    expect(lifecycle.ready(attempts[0] as AbortController)).toBe(true);
    await expect(first).resolves.toBeUndefined();
    expect(lifecycle.state).toBe("open");
    expect(lifecycle.connect()).toBe(first);
    expect(teardowns).toEqual([]);
  });

  it("refuses ready for an attempt that already ended", async () => {
    const { lifecycle, attempts, events } = harness();
    const pending = lifecycle.connect();
    const stale = attempts[0] as AbortController;

    lifecycle.fail(new VeloError("gone"), abnormalCloseEvent());
    await expect(pending).rejects.toThrow("gone");
    const next = lifecycle.connect();

    expect(stale.signal.aborted).toBe(true);
    expect(lifecycle.ready(stale)).toBe(false);
    expect(lifecycle.state).toBe("connecting");
    expect(lifecycle.ready(attempts[1] as AbortController)).toBe(true);
    await expect(next).resolves.toBeUndefined();
    expect(events).toEqual(["close:1006"]);
  });

  it("rejects a failed attempt without an error event, then emits close", async () => {
    const { lifecycle, attempts, teardowns, events } = harness();
    const pending = lifecycle.connect();

    lifecycle.fail(new VeloError("refused"), abnormalCloseEvent());

    await expect(pending).rejects.toThrow("refused");
    expect(lifecycle.state).toBe("disconnected");
    expect((attempts[0] as AbortController).signal.aborted).toBe(true);
    expect(teardowns).toEqual(["failed"]);
    expect(events).toEqual(["close:1006"]);
  });

  it("emits error then close when an open connection fails, tearing down first", () => {
    const { lifecycle, attempts, teardowns, events } = harness();
    void lifecycle.connect();
    lifecycle.ready(attempts[0] as AbortController);
    lifecycle.emitter.on("error", () => {
      expect(teardowns).toEqual(["failed"]);
      expect(lifecycle.state).toBe("disconnected");
    });

    lifecycle.fail(new VeloError("dropped"), { code: 1011, reason: "", wasClean: false });

    expect(events).toEqual(["error:dropped", "close:1011"]);
    expect(lifecycle.fail(new VeloError("again"), abnormalCloseEvent())).toBeUndefined();
    expect(events).toHaveLength(2);
  });

  it("counts a synchronous throw from start as a failed attempt", async () => {
    const { lifecycle, teardowns, events } = harness({
      start: () => {
        throw new Error("no socket");
      },
    });

    await expect(lifecycle.connect()).rejects.toThrow(/connection failed/);
    expect(lifecycle.state).toBe("disconnected");
    expect(teardowns).toEqual(["failed"]);
    expect(events).toEqual(["close:1006"]);
  });

  it("disconnects intentionally and reconnects from idle with a fresh attempt", async () => {
    const { lifecycle, attempts, teardowns, events } = harness();
    const pending = lifecycle.connect();

    lifecycle.disconnect();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(lifecycle.state).toBe("idle");
    expect(teardowns).toEqual(["disconnected"]);
    expect(events).toEqual(["close:1000"]);

    const again = lifecycle.connect();
    expect(attempts).toHaveLength(2);
    expect(attempts[1]).not.toBe(attempts[0]);
    lifecycle.disconnect();
    await expect(again).rejects.toMatchObject({ name: "AbortError" });
    lifecycle.disconnect();
    expect(teardowns).toEqual(["disconnected", "disconnected"]);
  });

  it("moves a disconnected watcher to idle without tearing down again", () => {
    const { lifecycle, teardowns, events } = harness();
    void lifecycle.connect().catch(() => {});
    lifecycle.fail(new VeloError("gone"), abnormalCloseEvent());

    lifecycle.disconnect();

    expect(lifecycle.state).toBe("idle");
    expect(teardowns).toEqual(["failed"]);
    expect(events).toEqual(["close:1006"]);
  });

  it("closes while connecting, rejects the shared promise, and clears listeners", async () => {
    const { lifecycle, attempts, teardowns, events } = harness();
    const first = lifecycle.connect();
    const second = lifecycle.connect();

    lifecycle.close();
    lifecycle.close();

    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    await expect(second).rejects.toMatchObject({ name: "AbortError" });
    expect(lifecycle.state).toBe("closed");
    expect((attempts[0] as AbortController).signal.aborted).toBe(true);
    expect(teardowns).toEqual(["closed"]);
    expect(events).toEqual(["close:1000"]);
    await expect(lifecycle.connect()).rejects.toThrow(/closed/);
    expect(lifecycle.ready(attempts[0] as AbortController)).toBe(false);

    lifecycle.emitter.emit("close", abnormalCloseEvent());
    expect(events).toHaveLength(1);
  });

  it("closes silently from idle and from disconnected", () => {
    const idle = harness();
    idle.lifecycle.close();
    expect(idle.teardowns).toEqual([]);
    expect(idle.events).toEqual([]);

    const dropped = harness();
    void dropped.lifecycle.connect().catch(() => {});
    dropped.lifecycle.fail(new VeloError("gone"), abnormalCloseEvent());
    dropped.lifecycle.close();
    expect(dropped.lifecycle.state).toBe("closed");
    expect(dropped.teardowns).toEqual(["failed"]);
    expect(dropped.events).toEqual(["close:1006"]);
  });

  it("does not start with an aborted signal, and closes when the signal aborts", async () => {
    const reason = new Error("stop");
    const aborted = harness({ signal: AbortSignal.abort(reason) });
    await expect(aborted.lifecycle.connect()).rejects.toBe(reason);
    expect(aborted.attempts).toEqual([]);
    expect(aborted.teardowns).toEqual([]);
    expect(aborted.events).toEqual(["close:1000"]);

    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const live = harness({ signal: controller.signal });
    void live.lifecycle.connect();
    live.lifecycle.ready(live.attempts[0] as AbortController);

    controller.abort(reason);

    expect(live.lifecycle.state).toBe("closed");
    expect(live.teardowns).toEqual(["closed"]);
    expect(live.events).toEqual(["close:1000"]);
    expect(remove).toHaveBeenCalledOnce();
  });

  it("lets a close listener reconnect during a failure", async () => {
    const { lifecycle, attempts, teardowns } = harness();
    void lifecycle.connect();
    lifecycle.ready(attempts[0] as AbortController);
    let reconnected: Promise<void> | undefined;
    lifecycle.emitter.on("close", () => {
      if (lifecycle.state === "disconnected") reconnected = lifecycle.connect();
    });

    lifecycle.fail(new VeloError("dropped"), abnormalCloseEvent());

    expect(lifecycle.state).toBe("connecting");
    expect(attempts).toHaveLength(2);
    expect(teardowns).toEqual(["failed"]);
    expect(lifecycle.ready(attempts[0] as AbortController)).toBe(false);
    expect(lifecycle.ready(attempts[1] as AbortController)).toBe(true);
    await expect(reconnected).resolves.toBeUndefined();
  });
});
