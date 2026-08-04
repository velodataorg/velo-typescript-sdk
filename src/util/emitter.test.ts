import { afterEach, describe, expect, it, vi } from "vitest";

import { SafeEmitter } from "./emitter.ts";

interface TestEvents {
  readonly value: number;
  readonly other: string;
}

/* Drains microtasks so asynchronous listener rejections get reported. */
async function flushReports(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("SafeEmitter", () => {
  it("delivers events to listeners of that type in registration order", () => {
    const emitter = new SafeEmitter<TestEvents>();
    const calls: string[] = [];
    emitter.on("value", (event) => calls.push(`first:${event}`));
    emitter.on("value", (event) => calls.push(`second:${event}`));
    emitter.on("other", (event) => calls.push(`other:${event}`));

    emitter.emit("value", 1);
    expect(calls).toEqual(["first:1", "second:1"]);

    emitter.emit("other", "x");
    expect(calls).toEqual(["first:1", "second:1", "other:x"]);
  });

  it("emits without listeners as a no-op", () => {
    const emitter = new SafeEmitter<TestEvents>();
    expect(() => emitter.emit("value", 1)).not.toThrow();
  });

  it("ignores duplicate registrations of the same listener", () => {
    const emitter = new SafeEmitter<TestEvents>();
    const listener = vi.fn();
    emitter.on("value", listener);
    emitter.on("value", listener);

    emitter.emit("value", 3);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("removes listeners and ignores unknown removals", () => {
    const emitter = new SafeEmitter<TestEvents>();
    const listener = vi.fn();
    emitter.on("value", listener);
    emitter.off("value", listener);
    emitter.off("value", () => undefined);
    emitter.off("other", () => undefined);

    emitter.emit("value", 4);
    expect(listener).not.toHaveBeenCalled();
  });

  it("dispatches each event to a snapshot of the listeners", () => {
    const emitter = new SafeEmitter<TestEvents>();
    const calls: string[] = [];
    const late = () => calls.push("late");
    const removed = () => calls.push("removed");
    emitter.on("value", () => {
      calls.push("first");
      emitter.on("value", late);
      emitter.off("value", removed);
    });
    emitter.on("value", removed);

    emitter.emit("value", 1);
    expect(calls).toEqual(["first", "removed"]);

    emitter.emit("value", 2);
    expect(calls).toEqual(["first", "removed", "first", "late"]);
  });

  it("keeps dispatching when a listener throws and reports via reportError", () => {
    const reportError = vi.fn();
    vi.stubGlobal("reportError", reportError);
    const emitter = new SafeEmitter<TestEvents>();
    const later = vi.fn();
    const thrown = new Error("listener failed");
    emitter.on("value", () => {
      throw thrown;
    });
    emitter.on("value", later);

    emitter.emit("value", 7);

    expect(reportError).toHaveBeenCalledWith(thrown);
    expect(later).toHaveBeenCalledWith(7);
  });

  it("logs listener failures without crashing when reportError is absent", async () => {
    // Node provides no reportError; this is the environment under test.
    expect("reportError" in globalThis).toBe(false);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const emitter = new SafeEmitter<TestEvents>();
    const later = vi.fn();
    const thrown = new Error("sync failure");
    const rejected = new Error("async failure");
    emitter.on("value", () => {
      throw thrown;
    });
    emitter.on("value", () => Promise.reject(rejected));
    emitter.on("value", later);

    emitter.emit("value", 7);

    expect(later).toHaveBeenCalledWith(7);
    expect(consoleError).toHaveBeenCalledWith("Velo SDK: uncaught error in event listener", thrown);
    await flushReports();
    expect(consoleError).toHaveBeenCalledWith(
      "Velo SDK: uncaught error in event listener",
      rejected,
    );
  });

  it("routes failures to a custom reporter instead of the default reporting", async () => {
    const reportError = vi.fn();
    vi.stubGlobal("reportError", reportError);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const report = vi.fn();
    const emitter = new SafeEmitter<TestEvents>(report);
    const thrown = new Error("sync failure");
    const rejected = new Error("async failure");
    emitter.on("value", () => {
      throw thrown;
    });
    emitter.on("value", () => Promise.reject(rejected));

    emitter.emit("value", 7);
    await flushReports();

    expect(report).toHaveBeenNthCalledWith(1, thrown);
    expect(report).toHaveBeenNthCalledWith(2, rejected);
    expect(reportError).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("falls back to the default reporting when the custom reporter throws", () => {
    const reportError = vi.fn();
    vi.stubGlobal("reportError", reportError);
    const reporterFailure = new Error("reporter failed");
    const report = vi.fn(() => {
      throw reporterFailure;
    });
    const emitter = new SafeEmitter<TestEvents>(report);
    const later = vi.fn();
    const thrown = new Error("listener failed");
    emitter.on("value", () => {
      throw thrown;
    });
    emitter.on("value", later);

    emitter.emit("value", 7);

    expect(report).toHaveBeenCalledWith(thrown);
    expect(reportError).toHaveBeenNthCalledWith(1, thrown);
    expect(reportError).toHaveBeenNthCalledWith(2, reporterFailure);
    expect(later).toHaveBeenCalledWith(7);
  });

  it("falls back to the default reporting when the custom reporter rejects", async () => {
    const reportError = vi.fn();
    vi.stubGlobal("reportError", reportError);
    const reporterFailure = new Error("reporter failed");
    const report = vi.fn(async () => {
      throw reporterFailure;
    });
    const emitter = new SafeEmitter<TestEvents>(report);
    const thrown = new Error("listener failed");
    emitter.on("value", () => {
      throw thrown;
    });

    emitter.emit("value", 7);
    await flushReports();

    expect(report).toHaveBeenCalledWith(thrown);
    expect(reportError).toHaveBeenNthCalledWith(1, thrown);
    expect(reportError).toHaveBeenNthCalledWith(2, reporterFailure);
  });

  it("reports rejecting thenables returned by listeners", async () => {
    const reportError = vi.fn();
    vi.stubGlobal("reportError", reportError);
    const emitter = new SafeEmitter<TestEvents>();
    const reason = new Error("thenable failure");
    emitter.on("value", () => ({
      // oxlint-disable-next-line unicorn/no-thenable -- a bare thenable is the case under test
      then(_resolve: unknown, reject: (reason: unknown) => void) {
        reject(reason);
      },
    }));

    emitter.emit("value", 1);
    await flushReports();

    expect(reportError).toHaveBeenCalledWith(reason);
  });

  it("clears every listener across types", () => {
    const emitter = new SafeEmitter<TestEvents>();
    const value = vi.fn();
    const other = vi.fn();
    emitter.on("value", value);
    emitter.on("other", other);

    emitter.clear();
    emitter.emit("value", 1);
    emitter.emit("other", "x");

    expect(value).not.toHaveBeenCalled();
    expect(other).not.toHaveBeenCalled();
  });
});
