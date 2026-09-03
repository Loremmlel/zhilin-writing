import type { DocxImportErrorCode, ParsedDocx } from "./types.ts";

export const DOCX_WORKER_PROGRESS_STAGES = [
  "package-validation",
  "xml-preload",
  "document-walk",
  "thread-validation",
  "markdown-generation",
  "done",
] as const;

export type DocxWorkerProgressStage = (typeof DOCX_WORKER_PROGRESS_STAGES)[number];

export type DocxWorkerRequest =
  | {
      kind: "start";
      requestId: string;
      filename: string;
      bytes: ArrayBuffer;
    }
  | {
      kind: "cancel";
      requestId: string;
    };

export type DocxWorkerResponse =
  | {
      kind: "progress";
      requestId: string;
      stage: DocxWorkerProgressStage;
    }
  | {
      kind: "success";
      requestId: string;
      result: ParsedDocx;
    }
  | {
      kind: "failure";
      requestId: string;
      error: {
        code: DocxImportErrorCode;
        message: string;
        details?: Readonly<Record<string, unknown>>;
      };
    };
