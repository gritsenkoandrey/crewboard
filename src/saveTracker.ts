/**
 * Учёт незавершённых сохранений, чтобы при закрытии окна ничего не потерять.
 * Компоненты регистрируют свои сохранения и «досохранялки» (сбросить отложенное автосохранение),
 * а App перед закрытием окна вызывает flushAll().
 */

const pending = new Set<Promise<unknown>>();
const flushers = new Set<() => void>();

/** Запоминает сохранение до его завершения. */
export function trackSave<T>(promise: Promise<T>): Promise<T> {
  pending.add(promise);
  const forget = () => pending.delete(promise);
  promise.then(forget, forget);
  return promise;
}

/** Регистрирует функцию, которая сразу запускает отложенное сохранение. Возвращает отписку. */
export function registerFlusher(flush: () => void): () => void {
  flushers.add(flush);
  return () => flushers.delete(flush);
}

/** Запускает все отложенные сохранения и ждёт завершения всех текущих. */
export async function flushAll(): Promise<void> {
  flushers.forEach((flush) => flush());
  await Promise.allSettled([...pending]);
}
