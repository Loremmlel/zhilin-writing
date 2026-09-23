import { search } from './planning/search';
import type { Decision, SearchRequest, SearchResponse } from './types';
declare const __HAOJIE_AI_WORKER__: string | undefined;
export type ExecutionMode = 'worker' | 'cooperative';
/**
 * 每个客户端同时只持有一个可取消请求，只发送脱敏观察。
 * 优先运行内联 Worker；不可用或无响应时清理旧资源，再用同一搜索器协作计算。
 * 取消与完成共用清理出口，终止线程、回收 Blob URL 并清除计时器。
 */
export class AiClient {
  private cancelCurrent: (() => void) | null = null;
  mode: ExecutionMode = 'cooperative';
  cancel() {
    this.cancelCurrent?.();
    this.cancelCurrent = null;
  }
  /** 新请求自动取消旧请求；取消以 AbortError 拒绝，宿主仍须阻止过期结果落子。 */
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
