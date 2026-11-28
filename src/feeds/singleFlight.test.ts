import { describe, expect, it } from 'vitest';
import { singleFlight } from './singleFlight';

/** A task whose runs finish when the test says so, recording the `force` each was started with. */
function harness() {
  const started: boolean[] = [];
  const finish: ((v: string) => void)[] = [];
  const run = singleFlight<string>(
    (force) =>
      new Promise((resolve) => {
        started.push(force);
        finish.push(resolve);
      }),
  );
  return { run, started, finish };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('singleFlight', () => {
  it('shares a run between calls that arrive while it is under way', async () => {
    const { run, started, finish } = harness();
    const a = run(false);
    const b = run(false);
    expect(started).toEqual([false]);
    finish[0]('one');
    expect(await a).toBe('one');
    expect(await b).toBe('one');
  });

  it('starts a fresh run once the last one has finished', async () => {
    const { run, started, finish } = harness();
    const a = run(false);
    finish[0]('one');
    await a;
    const b = run(true);
    expect(started).toEqual([false, true]);
    finish[1]('two');
    expect(await b).toBe('two');
  });

  it('runs a forced call after an unforced run, instead of handing back that run', async () => {
    const { run, started, finish } = harness();
    const launch = run(false);
    const checkNow = run(true);
    expect(started).toEqual([false]);
    finish[0]('launch');
    expect(await launch).toBe('launch');
    await tick();
    expect(started).toEqual([false, true]);
    finish[1]('forced');
    expect(await checkNow).toBe('forced');
  });

  it('shares one forced run between forced calls that arrive while an unforced run is under way', async () => {
    const { run, started, finish } = harness();
    void run(false);
    const a = run(true);
    const b = run(true);
    expect(a).toBe(b);
    finish[0]('launch');
    await tick();
    expect(started).toEqual([false, true]);
    finish[1]('forced');
    expect(await a).toBe('forced');
  });

  it('lets a call join a forced run that is already under way, forced or not', async () => {
    const { run, started, finish } = harness();
    const a = run(true);
    const b = run(true);
    const c = run(false);
    expect(started).toEqual([true]);
    finish[0]('forced');
    expect([await a, await b, await c]).toEqual(['forced', 'forced', 'forced']);
  });

  it('hands an unforced call that arrives while a forced run is waiting its turn that forced run', async () => {
    const { run, started, finish } = harness();
    void run(false);
    const forced = run(true);
    const late = run(false);
    expect(late).toBe(forced);
    finish[0]('launch');
    await tick();
    finish[1]('forced');
    expect(await late).toBe('forced');
    expect(started).toEqual([false, true]);
  });

  it('still runs the queued forced pass when the first run rejects', async () => {
    const started: boolean[] = [];
    const runs: { ok: (v: string) => void; fail: (e: Error) => void }[] = [];
    const run = singleFlight<string>(
      (force) =>
        new Promise((ok, fail) => {
          started.push(force);
          runs.push({ ok, fail });
        }),
    );
    const first = run(false);
    const forced = run(true);
    runs[0].fail(new Error('boom'));
    await expect(first).rejects.toThrow('boom');
    await tick();
    expect(started).toEqual([false, true]);
    runs[1].ok('forced');
    expect(await forced).toBe('forced');
  });

  it('turns a task that throws before returning a promise into a rejection, and runs fresh next time', async () => {
    let calls = 0;
    const run = singleFlight<string>(() => {
      calls += 1;
      if (calls === 1) throw new Error('sync boom');
      return Promise.resolve('fine');
    });
    await expect(run(false)).rejects.toThrow('sync boom');
    expect(await run(false)).toBe('fine');
    expect(calls).toBe(2);
  });

  it('is not left stuck when the queued forced run throws before returning a promise', async () => {
    const started: boolean[] = [];
    let finishFirst: (v: string) => void = () => {};
    const run = singleFlight<string>((force) => {
      started.push(force);
      if (started.length === 1) return new Promise((resolve) => (finishFirst = resolve));
      if (started.length === 2) throw new Error('sync boom');
      return Promise.resolve('recovered');
    });
    const first = run(false);
    const forced = run(true);
    finishFirst('one');
    expect(await first).toBe('one');
    await expect(forced).rejects.toThrow('sync boom');
    // The failed forced run must not be handed back forever.
    expect(await run(false)).toBe('recovered');
    expect(started).toEqual([false, true, false]);
  });
});
