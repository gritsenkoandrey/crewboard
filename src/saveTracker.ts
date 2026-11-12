/**
 * Track unfinished saves to avoid losing changes when the window closes.
 * Components register save operations and flushers that trigger pending autosaves,
 * and App calls flushAll() before closing the window.
 */

const pending = new Set<Promise<unknown>>();
const flushers = new Set<() => void>();

/** Tracks a save operation until it finishes. */
export function trackSave<T>(promise: Promise<T>): Promise<T> {
  pending.add(promise);
  const forget = () => pending.delete(promise);
  promise.then(forget, forget);
  return promise;
}

/** Registers a function that triggers pending saves immediately. Returns an unregister callback. */
export function registerFlusher(flush: () => void): () => void {
  flushers.add(flush);
  return () => flushers.delete(flush);
}

/** Flushes all pending saves and waits for all in-flight saves to finish. */
export async function flushAll(): Promise<void> {
  flushers.forEach((flush) => flush());
  await Promise.allSettled([...pending]);
}
