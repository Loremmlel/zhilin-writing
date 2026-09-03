import { parseDocx, type DocxParsePhase } from "./parse.ts";
import { DocxImportError } from "./types.ts";
import type { ParsedDocx } from "./types.ts";
import type {
  DocxWorkerProgressStage,
  DocxWorkerRequest,
  DocxWorkerResponse,
} from "./worker-protocol.ts";

const stageByPhase: Record<DocxParsePhase, DocxWorkerProgressStage> = {
  opening: "package-validation",
  lookups: "xml-preload",
  document: "document-walk",
  comments: "thread-validation",
  rendering: "markdown-generation",
};
const cancelledRequests = new Set<string>();

export async function handleDocxWorkerRequest(
  message: DocxWorkerRequest,
  post: (message: DocxWorkerResponse, transfer?: Transferable[]) => void,
): Promise<void> {
  if (message.kind === "cancel") {
    cancelledRequests.add(message.requestId);
    return;
  }
  const { requestId } = message;
  try {
    const result = await parseDocx(
      new File([message.bytes], message.filename),
      (phase) => {
        if (cancelledRequests.has(requestId)) {
          throw new DocxImportError("PARSE_ABORTED", "DOCX import was cancelled");
        }
        post({ kind: "progress", requestId, stage: stageByPhase[phase] });
      },
      {
        createAnnotationId: (sourceCommentId) => `docx-source-${sourceCommentId}`,
        createReplyId: (sourceCommentId) => `docx-source-${sourceCommentId}`,
      },
    );
    if (cancelledRequests.has(requestId)) return;
    post({ kind: "progress", requestId, stage: "done" });
    post({ kind: "success", requestId, result }, resultTransferables(result));
  } catch (error) {
    if (cancelledRequests.has(requestId)) return;
    const typed =
      error instanceof DocxImportError
        ? error
        : new DocxImportError("PARSE_FAILED", "DOCX import failed", undefined, { cause: error });
    post({
      kind: "failure",
      requestId,
      error: { code: typed.code, message: typed.message, details: typed.details },
    });
  } finally {
    cancelledRequests.delete(requestId);
  }
}

export function resultTransferables(result: ParsedDocx): Transferable[] {
  const buffers = new Set<ArrayBuffer>();
  for (const asset of result.assets) {
    if (asset.bytes.buffer instanceof ArrayBuffer) buffers.add(asset.bytes.buffer);
  }
  return [...buffers];
}

export interface DocxWorkerScope {
  addEventListener?: (
    type: "message",
    listener: (event: MessageEvent<DocxWorkerRequest>) => void,
  ) => void;
  postMessage?: (message: DocxWorkerResponse, transfer?: Transferable[]) => void;
}

export function registerDocxWorkerScope(scope: DocxWorkerScope): void {
  if (typeof scope.addEventListener !== "function" || typeof scope.postMessage !== "function")
    return;
  scope.addEventListener("message", (event) => {
    void handleDocxWorkerRequest(event.data, (message, transfer) => {
      scope.postMessage!(message, transfer);
    });
  });
}

const scope = globalThis as typeof globalThis & DocxWorkerScope;
registerDocxWorkerScope(scope);
