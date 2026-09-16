/**
 * Detects a connection that died without a close frame.
 *
 * The server sends a heartbeat on a fixed cadence to every subscriber, so a
 * long enough silence means the socket is gone even though it never said so.
 * Only heartbeats rearm the deadline: data frames arrive on the server's
 * schedule, not the connection's, so one says nothing about when the next
 * will come.
 */
export class HeartbeatDeadline {
  readonly #onExpire: () => void;
  readonly #timeout: number;
  #timer: ReturnType<typeof setTimeout> | undefined;

  /**
   * @param timeout - Milliseconds of silence tolerated after each heartbeat.
   * @param onExpire - Called once when the deadline passes without a reset.
   */
  constructor(timeout: number, onExpire: () => void) {
    this.#timeout = timeout;
    this.#onExpire = onExpire;
  }

  /** Starts the countdown, or restarts it when a heartbeat arrives. */
  reset(): void {
    this.clear();
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      this.#onExpire();
    }, this.#timeout);
  }

  /** Stops the countdown. Safe to call when it is not running. */
  clear(): void {
    if (this.#timer === undefined) return;
    clearTimeout(this.#timer);
    this.#timer = undefined;
  }
}
