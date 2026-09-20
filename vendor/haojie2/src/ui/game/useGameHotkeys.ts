import type { RefObject } from 'react';
import { useEffect, useRef } from 'react';
/** Attach a single listener; only the focused game owns shortcuts in a host page. */
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
        target.closest('input,textarea,select,[contenteditable="true"]')
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
