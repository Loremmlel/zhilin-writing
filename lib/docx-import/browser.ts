import { DOCX_IMPORT_LIMITS } from "./limits.ts";
import { renderCanonicalImportMarkdown } from "./markdown.ts";
import type {
  DocxWorkerProgressStage,
  DocxWorkerRequest,
  DocxWorkerResponse,
} from "./worker-protocol.ts";
import {
  DocxImportError,
  type DocxImportIR,
  type ImportedThread,
  type ParsedDocx,
} from "./types.ts";

export interface DocxWorkerLike {
  onmessage: ((event: MessageEvent<DocxWorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: DocxWorkerRequest, transfer?: Transferable[]): void;
  terminate(): void;
}

export interface DocxWorkerTimer {
  set(callback: () => void, delayMs: number): unknown;
  clear(handle: unknown): void;
}

export interface ParseDocxWithWorkerOptions {
  onProgress?: (stage: DocxWorkerProgressStage) => void;
  signal?: AbortSignal;
  timeoutMs?: number;
  workerFactory?: () => DocxWorkerLike;
  timer?: DocxWorkerTimer;
}

const defaultTimer: DocxWorkerTimer = {
  set: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clear: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export async function parseDocxWithWorker(
  file: File,
  options: ParseDocxWithWorkerOptions = {},
): Promise<ParsedDocx> {
  if (options.signal?.aborted) {
    throw new DocxImportError("PARSE_ABORTED", "DOCX import was cancelled");
  }
  let worker: DocxWorkerLike;
  try {
    worker = options.workerFactory?.() ?? createDocxWorker();
  } catch (error) {
    throw new DocxImportError("PARSE_FAILED", "Unable to start the DOCX import worker", undefined, {
      cause: error,
    });
  }
  const requestId = crypto.randomUUID();
  const timeoutMs = options.timeoutMs ?? DOCX_IMPORT_LIMITS.workerTimeoutMs;
  const timer = options.timer ?? defaultTimer;

  return new Promise((resolve, reject) => {
    let settled = false;
    let timeoutHandle: unknown = null;

    const cleanup = () => {
      if (timeoutHandle !== null) timer.clear(timeoutHandle);
      options.signal?.removeEventListener("abort", abort);
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
    };
    const succeed = (result: ParsedDocx) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };
    const fail = (error: DocxImportError) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const abort = () => {
      if (settled) return;
      try {
        worker.postMessage({ kind: "cancel", requestId });
      } catch {
        // Termination below is the cancellation boundary even if posting fails.
      }
      fail(new DocxImportError("PARSE_ABORTED", "DOCX import was cancelled"));
    };

    worker.onmessage = (event) => {
      const message = event.data;
      if (settled || message.requestId !== requestId) return;
      if (message.kind === "progress") {
        try {
          options.onProgress?.(message.stage);
        } catch (error) {
          fail(
            new DocxImportError("PARSE_FAILED", "DOCX import progress callback failed", undefined, {
              cause: error,
            }),
          );
        }
      } else if (message.kind === "success") {
        succeed(message.result);
      } else {
        fail(new DocxImportError(message.error.code, message.error.message, message.error.details));
      }
    };
    worker.onerror = (event) =>
      fail(new DocxImportError("PARSE_FAILED", event.message || "DOCX import worker failed"));
    options.signal?.addEventListener("abort", abort, { once: true });
    timeoutHandle = timer.set(
      () =>
        fail(
          new DocxImportError(
            "PARSE_TIMEOUT",
            `DOCX import exceeded the ${timeoutMs}-millisecond limit`,
            { timeoutMs },
          ),
        ),
      timeoutMs,
    );

    void file
      .arrayBuffer()
      .then((bytes) => {
        if (settled) return;
        worker.postMessage({ kind: "start", requestId, filename: file.name, bytes }, [bytes]);
      })
      .catch((error: unknown) =>
        fail(
          new DocxImportError("PARSE_FAILED", "Unable to read the DOCX source file", undefined, {
            cause: error,
          }),
        ),
      );
  });
}

export function finalizeDocxPreview(
  parsed: ParsedDocx,
  options: {
    importBatchId: string;
    sourceSha256: string;
    idFactory?: () => string;
  },
): DocxImportIR {
  const idFactory = options.idFactory ?? (() => crypto.randomUUID());
  const threads: ImportedThread[] = parsed.threads.map((thread) => ({
    ...thread,
    annotationId: `ann_${idFactory()}`,
    replies: thread.replies.map((reply) => ({ ...reply, replyId: idFactory() })),
  }));
  return {
    ...parsed,
    importBatchId: options.importBatchId,
    source: { ...parsed.source, sha256: options.sourceSha256 },
    threads,
    canonicalMarkdown: renderCanonicalImportMarkdown(parsed.blocks, parsed.assets, threads),
  };
}

export async function sha256DocxSource(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function createDocxWorker(): DocxWorkerLike {
  return new Worker(new URL("./docx-import.worker.ts", import.meta.url), { type: "module" });
}
