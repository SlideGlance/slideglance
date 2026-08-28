import { describe, expect, it } from "vitest";
import { CoalescingRunner } from "./coalescingRunner.js";

/** A promise plus the handles to settle it from the test body. */
function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
  reject: (err: unknown) => void;
} {
  let resolve!: () => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Let every already-queued microtask settle. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("CoalescingRunner", () => {
  it("runs a submission immediately when idle", async () => {
    const seen: string[] = [];
    const runner = new CoalescingRunner<string>(async (v) => {
      seen.push(v);
    }, fail);

    runner.submit("a");
    await flush();

    expect(seen).toEqual(["a"]);
    expect(runner.busy).toBe(false);
  });

  it("never runs two jobs at once", async () => {
    let concurrent = 0;
    let peak = 0;
    const gates = [deferred(), deferred()];
    let index = 0;
    const runner = new CoalescingRunner<number>(async () => {
      concurrent++;
      peak = Math.max(peak, concurrent);
      await gates[index++].promise;
      concurrent--;
    }, fail);

    runner.submit(1);
    runner.submit(2);
    await flush();
    gates[0].resolve();
    await flush();
    gates[1].resolve();
    await flush();

    expect(peak).toBe(1);
  });

  it("keeps only the newest input submitted during a run", async () => {
    const seen: number[] = [];
    const gate = deferred();
    const runner = new CoalescingRunner<number>(async (v) => {
      seen.push(v);
      if (v === 1) await gate.promise;
    }, fail);

    runner.submit(1);
    await flush();
    runner.submit(2);
    runner.submit(3);
    runner.submit(4);
    expect(runner.hasPending).toBe(true);

    gate.resolve();
    await flush();

    expect(seen).toEqual([1, 4]);
  });

  it("reports a failing job and keeps draining", async () => {
    const seen: number[] = [];
    const errors: unknown[] = [];
    const gate = deferred();
    const runner = new CoalescingRunner<number>(
      async (v) => {
        if (v === 1) {
          await gate.promise;
          throw new Error("boom");
        }
        seen.push(v);
      },
      (err) => errors.push(err),
    );

    runner.submit(1);
    await flush();
    runner.submit(2);
    gate.resolve();
    await flush();

    expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toBe("boom");
    expect(seen).toEqual([2]);
    expect(runner.busy).toBe(false);
  });

  it("accepts a fresh submission after the queue drained", async () => {
    const seen: string[] = [];
    const runner = new CoalescingRunner<string>(async (v) => {
      seen.push(v);
    }, fail);

    runner.submit("a");
    await flush();
    runner.submit("b");
    await flush();

    expect(seen).toEqual(["a", "b"]);
  });
});

describe("CoalescingRunner — merging superseded inputs", () => {
  it("folds a superseded input into the one replacing it", async () => {
    const seen: { text: string; full: boolean }[] = [];
    const gate = deferred();
    let jobs = 0;
    const runner = new CoalescingRunner<{ text: string; full: boolean }>(
      async (input) => {
        seen.push(input);
        if (++jobs === 1) await gate.promise;
      },
      fail,
      (superseded, next) => ({ ...next, full: superseded.full || next.full }),
    );

    runner.submit({ text: "a", full: false });
    await flush();
    // Both queue behind the running job: the newest text wins while the
    // full-rebuild demand survives being superseded.
    runner.submit({ text: "b", full: true });
    runner.submit({ text: "c", full: false });
    gate.resolve();
    await flush();

    expect(seen).toEqual([
      { text: "a", full: false },
      { text: "c", full: true },
    ]);
  });

  it("keeps the newest input verbatim when no merge is supplied", async () => {
    const seen: string[] = [];
    const gate = deferred();
    let jobs = 0;
    const runner = new CoalescingRunner<string>(async (v) => {
      seen.push(v);
      if (++jobs === 1) await gate.promise;
    }, fail);

    runner.submit("a");
    await flush();
    runner.submit("b");
    runner.submit("c");
    gate.resolve();
    await flush();

    expect(seen).toEqual(["a", "c"]);
  });
});

function fail(err: unknown): void {
  throw err instanceof Error ? err : new Error(String(err));
}
