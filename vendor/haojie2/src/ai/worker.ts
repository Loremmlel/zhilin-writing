import { search } from './search';
import type { SearchRequest, SearchResponse } from './types';
const port = self as unknown as {
  onmessage: ((e: MessageEvent<SearchRequest>) => void) | null;
  postMessage: (r: SearchResponse) => void;
};
port.onmessage = ({ data }) => {
  try {
    const iterator = search(data.observation, data.side, data.difficulty, data.limits);
    let last = performance.now();
    port.postMessage({ id: data.id, progress: true });
    let step = iterator.next();
    while (!step.done) {
      if (performance.now() - last >= 250) {
        port.postMessage({ id: data.id, progress: true });
        last = performance.now();
      }
      step = iterator.next();
    }
    port.postMessage({ id: data.id, decision: step.value });
  } catch (error) {
    port.postMessage({ id: data.id, error: error instanceof Error ? error.message : 'AI计算失败' });
  }
};
