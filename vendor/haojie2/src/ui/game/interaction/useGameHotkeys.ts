import type { RefObject } from 'react';
import { useEffect, useRef } from 'react';
/** 只挂一个监听器；嵌入宿主页时，仅焦点所在游戏响应快捷键。 */
export function useGameHotkeys(
  scope: RefObject<HTMLDivElement | null>,
  blocked: boolean,
  rewind: (forward?: boolean) => void,
  cancel: () => void,
) {
  const handlers = useRef({ blocked, rewind, cancel });
  handlers.current = { blocked, rewind, cancel };
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        handlers.current.blocked ||
        !(target instanceof HTMLElement) ||
        !scope.current?.contains(target) ||
        target.closest('dialog,input,textarea,select,[contenteditable="true"]')
      )
        return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        handlers.current.rewind(event.shiftKey);
      }
      if (event.key === 'Escape') handlers.current.cancel();
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [scope]);
}
