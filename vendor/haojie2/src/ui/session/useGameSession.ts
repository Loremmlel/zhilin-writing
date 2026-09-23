import { useEffect, useRef, useState } from 'react';
import type { Command, Session } from '../../engine';
import { createGame, createSession, dispatch } from '../../engine';
import type { HaojieGameProps } from '../game/interaction/types';
import type { SaveStatus } from './storage';
import { DEFAULT_STORAGE_KEY, readStoredSession, SAVE_LABELS, writeStoredSession } from './storage';
import { useGamePresentation } from './useGamePresentation';

export function randomSeed(): number {
  return typeof crypto !== 'undefined' && crypto.getRandomValues
    ? crypto.getRandomValues(new Uint32Array(1))[0] || 1
    : Date.now() >>> 0 || 1;
}
function boot(props: HaojieGameProps, key: string | null) {
  const fallback = () =>
    createSession(
      props.initialState ?? createGame(randomSeed(), props.initialMatch?.rules ?? 'classic'),
      props.initialMatch,
    );
  if (props.initialState || !key || typeof window === 'undefined')
    return { session: fallback(), notice: '', writable: true };
  try {
    return readStoredSession(window.localStorage, key, fallback);
  } catch {
    return { session: fallback(), notice: '浏览器禁止本机保存，请导出对局。', writable: false };
  }
}
/** 仅用于本地权威局面；受控入口不挂载此 Hook，也不启动其存档和 AI。 */
export function useGameSession(props: HaojieGameProps) {
  const storageKey = props.storageKey === undefined ? DEFAULT_STORAGE_KEY : props.storageKey;
  const [initial] = useState(() => boot(props, storageKey));
  const presentation = useGamePresentation(initial.notice);
  const { setNotice } = presentation;
  const [session, setSession] = useState(initial.session),
    live = useRef(session);
  const [writable, setWritable] = useState(initial.writable);
  const [status, setStatus] = useState<SaveStatus>(
    !storageKey ? 'disabled' : initial.writable ? 'saved' : 'blocked',
  );
  const callback = useRef(props.onStateChange);
  callback.current = props.onStateChange;
  useEffect(() => {
    if (!storageKey) {
      setStatus('disabled');
      return;
    }
    if (!writable) {
      setStatus('blocked');
      return;
    }
    let result: SaveStatus;
    try {
      result = writeStoredSession(window.localStorage, storageKey, session);
    } catch {
      result = 'unavailable';
    }
    setStatus(result);
    if (result === 'snapshot') setNotice('空间有限，仅保存当前局面；完整历史请导出。');
    if (result === 'unavailable') setNotice('浏览器禁止本机保存，请用“导出存档”保存对局。');
  }, [session, storageKey, writable]);
  useEffect(() => {
    callback.current?.(session.present);
  }, [session]);
  function replace(next: Session, explicit = false) {
    live.current = next;
    setSession(next);
    presentation.clear();
    if (explicit) setWritable(true);
  }
  function execute(command: Command) {
    const next = dispatch(live.current, command);
    live.current = next;
    setSession(next);
    setNotice('');
    presentation.play(next.present.events);
    return next;
  }
  return { ...presentation, session, live, replace, execute, saveStatus: SAVE_LABELS[status] };
}
