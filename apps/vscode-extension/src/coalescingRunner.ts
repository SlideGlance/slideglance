/**
 * Runs one job at a time and keeps only the newest request that arrived
 * while a job was running.
 *
 * The preview rebuilds an entire deck on every settled edit, and that
 * build is neither cancellable nor cheap. Two of them overlapping on the
 * extension host's single thread make each other slower without
 * producing an extra useful frame — the output of every superseded build
 * is discarded the moment the next one lands. This runner keeps exactly
 * one job in flight and collapses everything queued behind it into the
 * most recent input.
 */
export class CoalescingRunner<T> {
  private running = false;
  /** Boxed so a legitimately `undefined` input still counts as pending. */
  private pending: { value: T } | undefined;

  constructor(
    private readonly job: (input: T) => Promise<void>,
    private readonly onError: (err: unknown) => void,
  ) {}

  /** True while a job is executing. */
  get busy(): boolean {
    return this.running;
  }

  /** True when an input is waiting for the current job to finish. */
  get hasPending(): boolean {
    return this.pending !== undefined;
  }

  /**
   * Run `input` now when idle, otherwise replace whatever was waiting.
   * Returns immediately — the job runs on its own.
   */
  submit(input: T): void {
    this.pending = { value: input };
    if (!this.running) void this.drain();
  }

  private async drain(): Promise<void> {
    this.running = true;
    try {
      while (this.pending) {
        const next = this.pending.value;
        this.pending = undefined;
        try {
          await this.job(next);
        } catch (err) {
          // A job that throws must not strand the inputs queued behind
          // it, so report and keep draining. `job` owns its own error
          // handling; this is the backstop for the paths it cannot see
          // (a webview disposed mid-post, for instance).
          this.onError(err);
        }
      }
    } finally {
      this.running = false;
    }
  }
}
