/**
 * Runs `task(force)` one at a time, sharing a run between callers. A call that arrives while a run is
 * under way joins it, with one exception: a forced call can't join an unforced run, because that run
 * has already decided what to skip. It gets one forced run after it instead, shared by every call that
 * arrives before that one starts. Calls while a forced run is under way join it, since it covers them.
 *
 * `task` should not reject; a rejection reaches that run's callers and doesn't stop a queued run.
 */
export function singleFlight<T>(task: (force: boolean) => Promise<T>): (force: boolean) => Promise<T> {
  let current: { done: Promise<T>; force: boolean } | null = null;
  let queued: Promise<T> | null = null;

  const start = (force: boolean): Promise<T> => {
    const done: Promise<T> = task(force).finally(() => {
      if (current?.done === done) current = null;
    });
    current = { done, force };
    return done;
  };

  return (force) => {
    // A forced run is already waiting its turn, and it covers this call whichever kind it is.
    if (queued) return queued;
    if (!current) return start(force);
    if (!force || current.force) return current.done;
    const go = () => {
      const next = start(true);
      queued = null;
      return next;
    };
    queued = current.done.then(go, go);
    return queued;
  };
}
