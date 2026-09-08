import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  annotationLayoutMode,
  resolveActiveAnnotationId,
  nextAnnotationSheetState,
  resolveAnnotationSheetId,
  shouldUseAnnotationSheet,
} from "../../lib/annotations/responsive.ts";

test("annotation threads use a bottom sheet only at compact widths", () => {
  assert.equal(shouldUseAnnotationSheet(900), true);
  assert.equal(shouldUseAnnotationSheet(1181), true);
  assert.equal(shouldUseAnnotationSheet(1182), false);
  assert.equal(annotationLayoutMode(1181), "compact");
  assert.equal(annotationLayoutMode(1182), "desktop");
  assert.equal(
    nextAnnotationSheetState(null, { type: "activate", annotationId: "a", compact: true }),
    "a",
  );
  assert.equal(
    nextAnnotationSheetState(null, { type: "activate", annotationId: "a", compact: false }),
    null,
  );
  assert.equal(nextAnnotationSheetState("a", { type: "close" }), null);
});

test("readonly editor sheet closes when its live anchor retires and can reopen after Undo", () => {
  assert.equal(resolveAnnotationSheetId("a", ["a", "b"]), "a");
  assert.equal(resolveAnnotationSheetId("a", ["b"]), null);
  assert.equal(resolveAnnotationSheetId("a", ["a", "b"]), "a");
});

test("thread focus temporarily takes priority, hidden targets never leave orphan connectors", () => {
  assert.equal(resolveActiveAnnotationId("a", "b", ["a", "b"]), "b");
  assert.equal(resolveActiveAnnotationId("a", null, ["a", "b"]), "a");
  assert.equal(resolveActiveAnnotationId("a", "b", ["a"]), "a");
  assert.equal(resolveActiveAnnotationId("a", null, []), null);
  assert.equal(resolveActiveAnnotationId(null, null, ["a"]), null);
});

test("annotation and ordinary reply actions share an honest reply-then-delete layout", async () => {
  const [thread, replies, lazyReply, replyForm, annotationReplyForm, sheet, styles] =
    await Promise.all(
      [
        "../../components/annotations/annotation-thread.tsx",
        "../../components/reply-list.tsx",
        "../../components/lazy-reply-form.tsx",
        "../../components/reply-form.tsx",
        "../../components/annotations/annotation-reply-form.tsx",
        "../../components/annotations/annotation-sheet.tsx",
        "../../app/globals.css",
      ].map((path) => readFile(new URL(path, import.meta.url), "utf8")),
    );

  assert.equal(thread.match(/className="annotation-action-row"/g)?.length, 2);
  assert.match(thread, /annotation-reply-cta[\s\S]*?>\s*回复\s*</);
  assert.match(thread, /label="删除"/);
  assert.match(replies, /reply-action-row[\s\S]*LazyReplyForm[\s\S]*DeleteContentControl/);
  assert.match(lazyReply, /onCancel=/);
  assert.match(replyForm, />\s*取消回复\s*</);
  assert.match(annotationReplyForm, /onCancel[\s\S]*disabled=\{pending\}[\s\S]*取消回复/);
  assert.match(sheet, /props\.readOnly === true \? "查看这条正文批注。"/);
  assert.match(styles, /\.annotation-sheet-actions\s*\{[^}]*position:\s*sticky/);
});
