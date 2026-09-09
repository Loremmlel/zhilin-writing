import { AsyncLocalStorage } from "node:async_hooks";
export const requestPerformance = new AsyncLocalStorage<{
  requestId: string;
  dbMs: number;
  dbCount: number;
  r2Ms: number;
  r2Count: number;
}>();
