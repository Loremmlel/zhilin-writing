import { AsyncLocalStorage } from "node:async_hooks";
export const requestPerformance = new AsyncLocalStorage<{
  requestId: string;
  dbMs: number;
  dbCount: number;
  dbTrips?: number;
  dbSqlMs?: number;
  dbMetaCount?: number;
  dbRowsRead?: number;
  dbRowsWritten?: number;
  dbAttempts?: number;
  dbRegion?: string;
  operation?: string;
  r2Ms: number;
  r2Count: number;
}>();

export function markPerformanceOperation(
  operation: "annotation.create" | "annotation-reply.create",
) {
  const context = requestPerformance.getStore();
  if (context) context.operation = operation;
}
