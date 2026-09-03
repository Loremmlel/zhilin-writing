import type { ImportWarning, SkippedThread } from "./types.ts";

export function warningsWithoutSkippedThreadDuplicates(
  warnings: readonly ImportWarning[],
  skippedThreads: readonly SkippedThread[],
): ImportWarning[] {
  const skippedWarningKeys = new Set(
    skippedThreads.map((thread) =>
      warningKey(thread.warning.code, thread.warning.sourceRef ?? thread.sourceCommentId),
    ),
  );
  return warnings.filter(
    (warning) =>
      !warning.sourceRef || !skippedWarningKeys.has(warningKey(warning.code, warning.sourceRef)),
  );
}

function warningKey(code: ImportWarning["code"], sourceRef: string): string {
  return `${code}\u0000${sourceRef}`;
}
