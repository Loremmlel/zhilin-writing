import { search } from './search';
import type { Decision, SearchRequest, SearchResponse } from './types';
declare const __HAOJIE_AI_WORKER__: string | undefined;
export type ExecutionMode = 'worker' | 'cooperative';
/** One disposable request per client. Only sanitized observations are sent, never Session/GameState. */
export class AiClient {
  private cancelCurrent: (() => void) | null = null;
  mode: ExecutionMode = 'cooperative';
  cancel() {
    this.cancelCurrent?.();
    this.cancelCurrent = null;
  }
  plan(request: SearchRequest, forceFallback = false): Promise<Decision> {
    this.cancel();
    return new Promise((resolve, reject) => {
      let finished = false,
        worker: Worker | null = null,
        url: string | null = null,
        timer: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => {
        worker?.terminate();
        worker = null;
        if (url) URL.revokeObjectURL(url);
        url = null;
        clearTimeout(timer);
      };
      const done = (decision?: Decision, error?: Error) => {
        if (finished) return;
        finished = true;
        cleanup();
        this.cancelCurrent = null;
        error ? reject(error) : resolve(decision!);
      };
      this.cancelCurrent = () => done(undefined, new DOMException('AI请求已取消', 'AbortError'));
      const fallback = () => {
        cleanup();
        this.mode = 'cooperative';
        const iterator = search(
          request.observation,
          request.side,
          request.difficulty,
          request.limits,
        );
        const tick = () => {
          if (finished) return;
          try {
            const start = performance.now();
            let result = iterator.next();
            while (!result.done && performance.now() - start < 7) result = iterator.next();
            if (result.done) done(result.value);
            else timer = setTimeout(tick, 0);
          } catch (e) {
            done(undefined, e instanceof Error ? e : new Error('AI计算失败'));
          }
        };
        timer = setTimeout(tick, 0);
      };
      const source = typeof __HAOJIE_AI_WORKER__ === 'string' ? __HAOJIE_AI_WORKER__ : null;
      if (forceFallback || !source || typeof Worker === 'undefined') {
        fallback();
        return;
      }
      try {
        url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
        worker = new Worker(url);
        this.mode = 'worker';
        worker.onmessage = ({ data }: MessageEvent<SearchResponse>) => {
          if (data.id !== request.id) return;
          if (data.progress) {
            clearTimeout(timer);
            timer = setTimeout(fallback, 4000);
            return;
          }
          if (data.error) {
            fallback();
            return;
          }
          done(data.decision);
        };
        worker.onerror = (event) => {
          event.preventDefault();
          fallback();
        };
        timer = setTimeout(fallback, Math.max(4000, (request.limits?.milliseconds ?? 1000) + 3000));
        worker.postMessage(request);
      } catch {
        fallback();
      }
    });
  }
}
