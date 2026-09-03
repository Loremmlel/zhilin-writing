import assert from "node:assert/strict";
import test from "node:test";

import { warningsWithoutSkippedThreadDuplicates } from "../lib/docx-import/preview-warnings.ts";
import type { ImportWarning, SkippedThread } from "../lib/docx-import/types.ts";

test("keeps each skipped Word comment warning only in its detailed entry", () => {
  const warnings: ImportWarning[] = [
    { code: "VISUAL_FORMATTING_DROPPED", severity: "warning", count: 1 },
    { code: "ANNOTATION_CROSS_BLOCK", severity: "warning", sourceRef: "28" },
    { code: "ANNOTATION_CROSS_BLOCK", severity: "warning", sourceRef: "35" },
  ];
  const skippedThreads: SkippedThread[] = [
    {
      sourceCommentId: "28",
      sourceAuthorName: "林德游",
      sourceDocumentOrder: 28,
      warning: { code: "ANNOTATION_CROSS_BLOCK", severity: "warning", sourceRef: "28" },
    },
  ];

  assert.deepEqual(warningsWithoutSkippedThreadDuplicates(warnings, skippedThreads), [
    warnings[0],
    warnings[2],
  ]);
});
