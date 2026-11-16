export async function closeAll(cleanup: Array<() => unknown | Promise<unknown>>) {
  const errors: unknown[] = [];
  for (const close of cleanup.toReversed()) {
    try { await close(); } catch (error) { errors.push(error); }
  }
  if (errors.length) throw new AggregateError(errors, "Cleanup failed");
}
