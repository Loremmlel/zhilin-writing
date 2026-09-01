import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { assertOrdinaryPostMarkdown } from "../lib/annotations/policy.ts";

test("annotated authors reach the guarded editor and authoritative save path", () => {
  const editPage = readFileSync(new URL("../app/(site)/posts/[id]/edit/page.tsx", import.meta.url), "utf8");
  const service = readFileSync(new URL("../lib/posts/service.ts", import.meta.url), "utf8");
  const queries = readFileSync(new URL("../lib/annotations/queries.ts", import.meta.url), "utf8");

  assert.doesNotMatch(editPage, /if \(rawAnnotations\.length > 0\) return/);
  assert.match(editPage, /annotationThreads=\{annotationViews\}/);
  assert.match(editPage, /annotationEditing=\{annotationViews\.length > 0/);
  assert.doesNotMatch(service, /postHasCurrentAnnotationAnchors/);
  assert.doesNotMatch(service, /ANNOTATED_POST_EDIT_MESSAGE/);
  assert.doesNotMatch(queries, /postHasCurrentAnnotationAnchors/);
});

test("new unannotated posts still cannot forge annotation directives", () => {
  assert.equal(assertOrdinaryPostMarkdown("普通 **正文**"), "普通 **正文**");
  assert.throws(() => assertOrdinaryPostMarkdown(":annotation[伪造]{#ann_550e8400-e29b-41d4-a716-446655440000}"), /不能直接写入/);
});
