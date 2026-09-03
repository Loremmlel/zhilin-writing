export type DocxImportCommitLock = { current: boolean };

export function beginDocxImportCommit(lock: DocxImportCommitLock, transition: () => void): boolean {
  if (lock.current) return false;
  lock.current = true;
  transition();
  return true;
}
