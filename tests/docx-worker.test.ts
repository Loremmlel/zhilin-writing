import assert from "node:assert/strict";
import test from "node:test";

import {
  finalizeDocxPreview,
  parseDocxWithWorker,
  sha256DocxSource,
  type DocxWorkerLike,
  type DocxWorkerTimer,
} from "../lib/docx-import/browser.ts";
import {
  DOCX_WORKER_PROGRESS_STAGES,
  type DocxWorkerRequest,
  type DocxWorkerResponse,
} from "../lib/docx-import/worker-protocol.ts";
import { handleDocxWorkerRequest } from "../lib/docx-import/docx-import.worker.ts";
import { DocxImportError, type ParsedDocx } from "../lib/docx-import/types.ts";
import { makeDocxFixture } from "./helpers/docx-fixture.ts";

const SOURCE_UUID = "00000000-0000-4000-8000-000000000001";
const ROOT_UUID = "00000000-0000-4000-8000-000000000002";
const REPLY_UUID = "00000000-0000-4000-8000-000000000003";

class FakeWorker implements DocxWorkerLike {
  onmessage: ((event: MessageEvent<DocxWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly messages: DocxWorkerRequest[] = [];
  readonly transfers: Transferable[][] = [];
  terminated = false;
  private readonly onStart: (worker: FakeWorker) => void;

  constructor(onStart: (worker: FakeWorker) => void) {
    this.onStart = onStart;
  }

  postMessage(message: DocxWorkerRequest, transfer: Transferable[] = []): void {
    this.messages.push(message);
    this.transfers.push(transfer);
    if (message.kind === "start") queueMicrotask(() => this.onStart(this));
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(message: DocxWorkerResponse): void {
    this.onmessage?.({ data: message } as MessageEvent<DocxWorkerResponse>);
  }
}

test("uses the exact ordered DOCX worker stages and transfers source bytes once", async () => {
  assert.deepEqual(DOCX_WORKER_PROGRESS_STAGES, [
    "package-validation",
    "xml-preload",
    "document-walk",
    "thread-validation",
    "markdown-generation",
    "done",
  ]);
  const progress: string[] = [];
  const parsed = parsedFixture();
  const worker = new FakeWorker((current) => {
    const start = current.messages[0];
    assert.equal(start.kind, "start");
    if (start.kind !== "start") return;
    for (const stage of DOCX_WORKER_PROGRESS_STAGES) {
      current.emit({ kind: "progress", requestId: start.requestId, stage });
    }
    current.emit({ kind: "success", requestId: start.requestId, result: parsed });
  });

  const result = await parseDocxWithWorker(new File(["docx"], "source.docx"), {
    workerFactory: () => worker,
    onProgress: (stage) => progress.push(stage),
  });

  assert.equal(result, parsed);
  assert.deepEqual(progress, DOCX_WORKER_PROGRESS_STAGES);
  assert.equal(worker.messages.length, 1);
  assert.equal(worker.messages[0]?.kind, "start");
  assert.equal(worker.transfers[0]?.length, 1);
  assert.equal(worker.terminated, true);
});

test("the real worker emits every parse stage in order before success", async () => {
  const file = await makeDocxFixture();
  const responses: DocxWorkerResponse[] = [];
  await handleDocxWorkerRequest({
    kind: "start",
    requestId: "request-1",
    filename: file.name,
    bytes: await file.arrayBuffer(),
  }, (message) => responses.push(message));

  assert.deepEqual(
    responses.filter((message) => message.kind === "progress").map((message) => message.stage),
    DOCX_WORKER_PROGRESS_STAGES,
  );
  assert.equal(responses.at(-1)?.kind, "success");
});

test("preserves a structured worker error code and payload before terminating", async () => {
  const worker = new FakeWorker((current) => {
    const start = current.messages[0];
    assert.equal(start.kind, "start");
    if (start.kind !== "start") return;
    current.emit({
      kind: "failure",
      requestId: start.requestId,
      error: {
        code: "XML_MALFORMED",
        message: "bad document XML",
        details: { partName: "word/document.xml" },
      },
    });
  });

  await assert.rejects(
    parseDocxWithWorker(new File(["docx"], "source.docx"), { workerFactory: () => worker }),
    (error: unknown) => error instanceof DocxImportError
      && error.code === "XML_MALFORMED"
      && error.details?.partName === "word/document.xml",
  );
  assert.equal(worker.terminated, true);
});

test("wraps Worker startup failure as a typed parse error", async () => {
  await assert.rejects(
    parseDocxWithWorker(new File(["docx"], "source.docx"), {
      workerFactory: () => {
        throw new Error("worker unavailable");
      },
    }),
    (error: unknown) => error instanceof DocxImportError && error.code === "PARSE_FAILED",
  );
});

test("forwards caller abort as cancel and terminates the worker", async () => {
  const controller = new AbortController();
  const worker = new FakeWorker(() => controller.abort());

  await assert.rejects(
    parseDocxWithWorker(new File(["docx"], "source.docx"), {
      signal: controller.signal,
      workerFactory: () => worker,
    }),
    (error: unknown) => error instanceof DocxImportError && error.code === "PARSE_ABORTED",
  );
  assert.equal(worker.messages[1]?.kind, "cancel");
  assert.equal(worker.terminated, true);
});

test("terminates a timed-out DOCX worker with a typed error", async () => {
  let expire: (() => void) | undefined;
  const timer: DocxWorkerTimer = {
    set: (callback) => {
      expire = callback;
      return 1;
    },
    clear: () => undefined,
  };
  const worker = new FakeWorker(() => expire?.());

  await assert.rejects(
    parseDocxWithWorker(new File(["docx"], "source.docx"), {
      workerFactory: () => worker,
      timeoutMs: 20_000,
      timer,
    }),
    (error: unknown) => error instanceof DocxImportError && error.code === "PARSE_TIMEOUT",
  );
  assert.equal(worker.terminated, true);
});

test("finalizes batch root and reply IDs once and rerenders canonical Markdown", () => {
  const ids = [ROOT_UUID, REPLY_UUID];
  const finalized = finalizeDocxPreview(parsedFixture(), {
    importBatchId: SOURCE_UUID,
    sourceSha256: "abc123",
    idFactory: () => ids.shift()!,
  });

  assert.equal(finalized.importBatchId, SOURCE_UUID);
  assert.equal(finalized.source.sha256, "abc123");
  assert.equal(finalized.threads[0]?.annotationId, `ann_${ROOT_UUID}`);
  assert.equal(finalized.threads[0]?.replies[0]?.replyId, REPLY_UUID);
  assert.match(finalized.canonicalMarkdown, new RegExp(`\\{#ann_${ROOT_UUID}\\}`));
  assert.doesNotMatch(finalized.canonicalMarkdown, /source-root/);
  assert.deepEqual(ids, []);
});

test("computes the source SHA-256 without retaining the source file", async () => {
  assert.equal(
    await sha256DocxSource(new File(["abc"], "source.docx")),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});

function parsedFixture(): ParsedDocx {
  return {
    version: 1,
    source: { filename: "source.docx", producer: "Word" },
    suggestedTitle: "Imported",
    blocks: [{
      id: "p1",
      type: "paragraph",
      segments: [{ text: "正文", marks: [], commentIds: ["10"] }],
    }],
    assets: [],
    threads: [{
      annotationId: "source-root",
      sourceCommentId: "10",
      blockId: "p1",
      blockLocalStart: 0,
      blockLocalEnd: 2,
      sourceAuthorName: "Author",
      sourceDocumentOrder: 0,
      sourceResolved: false,
      bodyMarkdown: "Root",
      replies: [{
        replyId: "source-reply",
        sourceCommentId: "11",
        parentSourceCommentId: "10",
        sourceAuthorName: "Reply Author",
        sourceDocumentOrder: 1,
        sourceResolved: false,
        bodyMarkdown: "Reply",
      }],
    }],
    skippedThreads: [],
    warnings: [],
    canonicalMarkdown: ":annotation[正文]{#source-root}",
  };
}
