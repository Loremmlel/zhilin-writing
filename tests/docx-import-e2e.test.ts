import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { Editor, parserCtx, rootCtx } from "@milkdown/kit/core";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { Window } from "happy-dom";

import { buildAnnotationAuthorView } from "../lib/annotations/identity.ts";
import { collectAnnotationIds, parseAnnotationMarkdown } from "../lib/annotations/markdown.ts";
import { annotationPlugin } from "../lib/editor/annotation-mark.ts";
import { finalizeDocxPreview } from "../lib/docx-import/browser.ts";
import { validateDocxImportCommitPayload, planDocxImportCommit } from "../lib/docx-import/commit-plan.ts";
import { toDocxImportCommitPayload } from "../lib/docx-import/commit-schema.ts";
import { handleDocxWorkerRequest } from "../lib/docx-import/docx-import.worker.ts";
import { replaceDocxAssetReferences } from "../lib/docx-import/preview-assets.ts";
import { validateEditedImportPreview } from "../lib/docx-import/preview-validation.ts";
import type { DocxImportIR, DocxPreviewAsset, ParsedDocx } from "../lib/docx-import/types.ts";
import { DOCX_WORKER_PROGRESS_STAGES, type DocxWorkerResponse } from "../lib/docx-import/worker-protocol.ts";

const fixturePath = resolve("tests/fixtures/docx/generated/semantic-matrix.docx");
const expectedPath = resolve("tests/fixtures/docx/expected/normalized-ir.json");
const batchId = "00000000-0000-4000-8000-000000000100";
const importerId = "00000000-0000-4000-8000-000000000101";
const attributedId = "00000000-0000-4000-8000-000000000102";

test("the generated semantic matrix is deterministic across the complete import pipeline", async () => {
  const check = spawnSync(process.execPath, ["scripts/fixtures/generate-docx-fixtures.mjs", "--check"], {
    cwd: resolve("."),
    encoding: "utf8",
  });
  assert.equal(check.status, 0, `${check.stdout}\n${check.stderr}`);
  assert.match(check.stdout, /verified 4 generated DOCX fixtures/);
  const bytes = await readFile(fixturePath);
  const firstWorker = await runWorker(bytes);
  const secondWorker = await runWorker(bytes);
  assert.deepEqual(firstWorker.stages, [...DOCX_WORKER_PROGRESS_STAGES]);
  assert.deepEqual(secondWorker.stages, firstWorker.stages);
  const sourceSha256 = createHash("sha256").update(bytes).digest("hex");

  const first = finalizeDocxPreview(firstWorker.result, {
    importBatchId: batchId,
    sourceSha256,
    idFactory: sequentialIdsWithClosure(),
  });
  const second = finalizeDocxPreview(secondWorker.result, {
    importBatchId: batchId,
    sourceSha256,
    idFactory: sequentialIdsWithGenerator(),
  });
  assertSemanticMatrix(first);
  assert.deepEqual(normalizeImport(first), normalizeImport(second));
  assert.equal(first.canonicalMarkdown, second.canonicalMarkdown);
  assert.equal(JSON.stringify(first.warnings), JSON.stringify(second.warnings));

  const expected = JSON.parse(await readFile(expectedPath, "utf8"));
  assert.deepEqual(normalizeImport(first), expected);

  const uploaded = first.assets.map((asset, index) => ({
    source: asset,
    uploaded: temporaryAsset(asset, index),
  }));
  const markdown = replaceDocxAssetReferences(first.canonicalMarkdown, uploaded);
  const ir: DocxImportIR = { ...first, canonicalMarkdown: markdown };
  const authorMappings = Object.fromEntries(
    [...new Set(first.threads.flatMap((thread) => [thread.sourceAuthorName, ...thread.replies.map((reply) => reply.sourceAuthorName)]))]
      .map((author) => [author, attributedId]),
  );
  const preview = {
    version: 1 as const,
    importBatchId: batchId,
    title: first.suggestedTitle,
    createdAt: "2026-08-30T00:00:00.000Z",
    expiresAt: "2026-09-01T00:00:00.000Z",
    ir,
    canonicalMarkdown: markdown,
    markdown,
    temporaryAssets: uploaded.map(({ uploaded: item }) => item),
    authorMappings,
  };
  const checked = validateEditedImportPreview(preview, Date.parse("2026-08-30T01:00:00.000Z"), new Set([attributedId]));
  assert.equal(checked.ok, true, checked.ok ? undefined : JSON.stringify(checked.errors));
  if (!checked.ok) return;

  const payload = toDocxImportCommitPayload(checked.payload);
  const validated = validateDocxImportCommitPayload(payload);
  const plan = planDocxImportCommit(validated, {
    importerUserId: importerId,
    importerDisplayName: "柚子",
    postId: "00000000-0000-4000-8000-000000000103",
    revisionId: "00000000-0000-4000-8000-000000000104",
    eventId: "00000000-0000-4000-8000-000000000105",
    payloadHash: "b".repeat(64),
    now: new Date("2026-08-30T01:00:00.000Z"),
    assets: preview.temporaryAssets.map((asset) => ({
      id: asset.assetId,
      ownerId: importerId,
      kind: "image" as const,
      mimeType: asset.mimeType,
      status: "temporary" as const,
      deletedAt: null,
    })),
  });
  const rows = Object.fromEntries(plan.rowChunks.map((row) => [row.kind, (plan.rowChunks.filter((item) => item.kind === row.kind).reduce((sum, item) => sum + item.rowCount, 0))]));
  assert.equal(rows.post, 1);
  assert.equal(rows.revision, 1);
  assert.equal(rows["import-batch"], 1);
  assert.equal(rows.annotations, first.threads.length);
  assert.equal(rows["annotation-snapshots"], first.threads.length);
  assert.equal(rows["annotation-replies"] ?? 0, first.threads.flatMap((thread) => thread.replies).length);
  assert.equal(rows["reply-snapshots"] ?? 0, first.threads.flatMap((thread) => thread.replies).length);

  const annotationIds = collectAnnotationIds(parseAnnotationMarkdown(validated.markdown));
  assert.deepEqual(annotationIds, first.threads.map((thread) => thread.annotationId));
  const documentJson = await parseWithMilkdown(validated.markdown);
  assert.equal(documentJson.type, "doc");
  assert.ok(JSON.stringify(documentJson).includes("annotation"));

  const importedAuthor = buildAnnotationAuthorView({
    sourceType: "DOCX_IMPORT",
    authorId: null,
    sourceAuthorName: first.threads[0]!.sourceAuthorName,
    sourceInitials: first.threads[0]!.sourceInitials ?? null,
    sourceResolved: first.threads[0]!.sourceResolved,
  }, null, { id: attributedId, displayName: "关联用户", avatarAssetId: null });
  assert.equal(importedAuthor.id, null);
  assert.equal(importedAuthor.displayName, first.threads[0]!.sourceAuthorName);
  assert.equal(importedAuthor.attributedUser?.id, attributedId);
});

async function runWorker(bytes: Uint8Array): Promise<{ result: ParsedDocx; stages: string[] }> {
  const responses: DocxWorkerResponse[] = [];
  const transferableBytes = Uint8Array.from(bytes).buffer;
  await handleDocxWorkerRequest({
    kind: "start",
    requestId: "semantic-matrix",
    filename: "semantic-matrix.docx",
    bytes: transferableBytes,
  }, (message) => responses.push(message));
  const failure = responses.find((message) => message.kind === "failure");
  assert.equal(failure, undefined, failure?.kind === "failure" ? JSON.stringify(failure.error) : undefined);
  const success = responses.find((message) => message.kind === "success");
  assert.ok(success?.kind === "success");
  return {
    result: success.result,
    stages: responses.filter((message) => message.kind === "progress").map((message) => message.stage),
  };
}

function sequentialIdsWithClosure(): () => string {
  let next = 1;
  return () => `00000000-0000-4000-8000-${String(next++).padStart(12, "0")}`;
}

function sequentialIdsWithGenerator(): () => string {
  function* ids() {
    for (let next = 1; ; next += 1) yield `00000000-0000-4000-8000-${String(next).padStart(12, "0")}`;
  }
  const iterator = ids();
  return () => iterator.next().value!;
}

function temporaryAsset(asset: ParsedDocx["assets"][number], index: number): DocxPreviewAsset {
  const assetId = `00000000-0000-4000-9000-${String(index + 1).padStart(12, "0")}`;
  return { assetId, temporaryUrl: `/api/assets/${assetId}`, filename: asset.filename, mimeType: asset.mimeType };
}

function normalizeImport(ir: DocxImportIR) {
  const ids = new Map<string, string>();
  ir.threads.forEach((thread, index) => {
    ids.set(thread.annotationId, `ann_<${index + 1}>`);
    thread.replies.forEach((reply, replyIndex) => ids.set(reply.replyId, `reply_<${index + 1}.${replyIndex + 1}>`));
  });
  const replaceIds = (value: string) => [...ids].reduce((text, [id, replacement]) => text.replaceAll(id, replacement), value);
  return {
    version: ir.version,
    importBatchId: "<batch-uuid>",
    source: ir.source,
    suggestedTitle: ir.suggestedTitle,
    blocks: ir.blocks,
    assets: ir.assets.map(({ bytes, ...asset }) => ({
      ...asset,
      byteLength: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    })),
    threads: ir.threads.map((thread) => ({
      ...thread,
      annotationId: ids.get(thread.annotationId),
      replies: thread.replies.map((reply) => ({ ...reply, replyId: ids.get(reply.replyId) })),
    })),
    skippedThreads: ir.skippedThreads,
    warnings: ir.warnings,
    canonicalMarkdown: replaceIds(ir.canonicalMarkdown),
  };
}

function assertSemanticMatrix(ir: DocxImportIR) {
  const headings = ir.blocks.filter((block) => block.type === "heading");
  assert.deepEqual(headings.map((block) => [
    block.level,
    block.segments.map((segment) => segment.text).join(""),
  ]), [
    [1, "一级标题"], [2, "二级标题"], [3, "三级标题"], [4, "四级标题"],
    [4, "五级标题"], [4, "六级标题"], [4, "七级标题"], [4, "八级标题"], [4, "九级标题"],
  ]);
  const allSegments = ir.blocks.flatMap((block) => "segments" in block ? block.segments : []);
  assert.deepEqual(allSegments.find((segment) => segment.text === "继承粗体")?.marks, ["strong"]);
  assert.deepEqual(allSegments.find((segment) => segment.text === "代码样式")?.marks, ["code"]);
  assert.deepEqual(allSegments.find((segment) => segment.text === "非代码样式")?.marks, []);
  assert.equal(allSegments.find((segment) => segment.text === "安全链接")?.link, "https://example.com/safe?q=1");
  assert.equal(allSegments.find((segment) => segment.text === "不安全链接")?.link, undefined);
  assert.deepEqual(ir.blocks.filter((block) => block.type === "quote").map((block) => block.segments[0]?.text), ["普通引用", "强调引用"]);
  assert.deepEqual(ir.blocks.filter((block) => block.type === "list").slice(0, 4).map((block) => [block.ordered, block.depth]), [
    [false, 0], [true, 1], [true, 2], [true, 2],
  ]);
  assert.equal(ir.blocks.filter((block) => block.type === "table").length, 3);
  assert.equal(ir.blocks.filter((block) => block.type === "image").length, 3);
  assert.deepEqual(ir.assets.map((asset) => asset.floating), [false, true, false]);
  assert.equal(ir.blocks.at(-1)?.type, "notesAppendix");
  assert.match(ir.canonicalMarkdown, /缓存字段/);
  assert.doesNotMatch(ir.canonicalMarkdown, /目录缓存|删除修订|javascript:/i);
  assert.match(ir.canonicalMarkdown, /保留插入保留移动/);
  assert.match(ir.canonicalMarkdown, /文本框一 \/ 文本框二/);
  assert.match(ir.canonicalMarkdown, /\[公式\]/);
  assert.match(ir.canonicalMarkdown, /中[\s\S]*😀[\s\S]*é[\s\S]*אב/);
  assert.deepEqual(ir.threads.map((thread) => thread.sourceCommentId), ["25", "1", "2", "3", "4", "10"]);
  assert.equal(ir.threads.find((thread) => thread.sourceCommentId === "10")?.sourceResolved, true);
  assert.deepEqual(ir.threads.find((thread) => thread.sourceCommentId === "10")?.replies.map((reply) => [
    reply.sourceCommentId,
    reply.parentSourceCommentId,
  ]), [["11", "10"]]);
  assert.deepEqual(ir.skippedThreads.map((thread) => [thread.sourceCommentId, thread.warning.code]), [
    ["5", "ANNOTATION_OVERLAP_SKIPPED"],
    ["20", "ANNOTATION_EMPTY_RANGE"],
    ["21", "ANNOTATION_CROSS_BLOCK"],
    ["22", "ANNOTATION_TABLE_UNSUPPORTED"],
    ["23", "ANNOTATION_ORPHAN_DEFINITION"],
    ["24", "ANNOTATION_NON_TEXT_RANGE"],
    ["26", "ANNOTATION_THREAD_SKIPPED"],
    ["30", "ANNOTATION_THREAD_SKIPPED"],
  ]);
  const warnings = new Set(ir.warnings.map((warning) => warning.code));
  for (const code of [
    "HEADING_LEVEL_CLAMPED", "LIST_DEPTH_CLAMPED", "HYPERLINK_UNSAFE_DROPPED", "TOC_SKIPPED",
    "TRACK_CHANGES_FLATTENED", "TABLE_HEADER_SYNTHESIZED", "TABLE_MERGED_CELLS_FLATTENED",
    "FLOATING_IMAGE_FLATTENED", "TEXTBOX_FLATTENED", "EQUATION_SKIPPED", "NOTES_FLATTENED_TO_APPENDIX",
  ]) assert.ok(warnings.has(code as never), code);
}

async function parseWithMilkdown(markdown: string): Promise<Record<string, unknown>> {
  const window = new Window({ url: "https://example.test" });
  Object.assign(globalThis, {
    window,
    document: window.document,
    Node: window.Node,
    HTMLElement: window.HTMLElement,
    Element: window.Element,
    MutationObserver: window.MutationObserver,
    DOMParser: window.DOMParser,
    getSelection: window.getSelection.bind(window),
    addEventListener: window.addEventListener.bind(window),
    removeEventListener: window.removeEventListener.bind(window),
    dispatchEvent: window.dispatchEvent.bind(window),
    requestAnimationFrame: (callback: FrameRequestCallback) => window.setTimeout(() => callback(Date.now()), 0),
    cancelAnimationFrame: (id: number) => window.clearTimeout(id as unknown as ReturnType<typeof window.setTimeout>),
  });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: window.navigator });
  const root = window.document.createElement("div");
  window.document.body.append(root);
  const editor = await Editor.make()
    .config((ctx) => ctx.set(rootCtx, root as unknown as Node))
    .use(commonmark)
    .use(gfm)
    .use(annotationPlugin)
    .create();
  try {
    return editor.ctx.get(parserCtx)(markdown).toJSON() as Record<string, unknown>;
  } finally {
    await editor.destroy();
    window.close();
  }
}
