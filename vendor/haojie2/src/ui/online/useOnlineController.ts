import { useEffect, useRef, useState } from 'react';
import { actorCommandError, type Command } from '../../engine';
import { LOCAL_MATCH } from '../../match/settings';
import type { GameModal } from '../game/types';
import { useGameInteraction } from '../game/useGameInteraction';
import { useGamePresentation } from '../session/useGamePresentation';
import { selectOnlineUpdate, type HaojieOnlineGameProps } from './types';

interface Submission {
  abort: AbortController;
  acceptedRevision?: number;
}
/** Caches only host snapshots. It never creates a game, dispatches a rule or opens local storage. */
export function useOnlineController(props: HaojieOnlineGameProps) {
  const [update, setUpdate] = useState(props.update);
  const incoming = selectOnlineUpdate(update, props.update);
  if (incoming !== update) setUpdate(incoming);
  const current = useRef(update);
  current.current = update;
  const config = useRef(props);
  config.current = props;
  const presentation = useGamePresentation();
  const [submitting, setSubmitting] = useState(false);
  const [modal, setModal] = useState<GameModal>(null);
  const pending = useRef<Submission | null>(null);
  const mounted = useRef(true);
  const played = useRef(update.revision);
  const { state, viewer } = update.view;
  function release(request: Submission) {
    if (pending.current !== request) return;
    pending.current = null;
    if (mounted.current) setSubmitting(false);
  }
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      pending.current?.abort.abort();
      pending.current = null;
    };
  }, []);
  useEffect(() => {
    if (props.connection === 'connected') return;
    const request = pending.current;
    if (request) {
      request.abort.abort();
      release(request);
    }
    presentation.clear();
  }, [props.connection]);
  useEffect(() => {
    if (props.error) presentation.setNotice(props.error.message);
  }, [props.error?.id]);
  useEffect(() => {
    if (update.revision > played.current) {
      played.current = update.revision;
      if (update.kind === 'snapshot' || config.current.connection !== 'connected')
        presentation.clear();
      else presentation.play(update.view.state.events);
    }
    const request = pending.current;
    if (request?.acceptedRevision !== undefined && update.revision >= request.acceptedRevision)
      release(request);
  }, [update]);

  // An equal-revision reconnect snapshot clears effects, never newer state or a pending ack.
  useEffect(() => {
    if (props.update.kind === 'snapshot' && props.update.revision >= current.current.revision)
      presentation.clear();
  }, [props.update]);

  function connectionBlock(): string | null {
    if (config.current.connection !== 'connected')
      return config.current.connection === 'connecting'
        ? '正在连接，请等待局面同步。'
        : '连接已断开，请恢复连接并同步局面。';
    if (config.current.disabled) return '宿主暂时暂停了操作。';
    if (pending.current) return '正在等待本次提交的服务器结果。';
    return null;
  }
  function commandBlock(c: Command): string | null {
    return (
      connectionBlock() ??
      actorCommandError(current.current.view.state, current.current.view.viewer, c)
    );
  }
  function submit(c: Command): null {
    const blocked = commandBlock(c);
    if (blocked) throw new Error(blocked);
    const request: Submission = { abort: new AbortController() };
    const baseRevision = current.current.revision;
    const send = config.current.onCommand;
    pending.current = request;
    setSubmitting(true);
    const command = structuredClone(c);
    Promise.resolve()
      .then(() => {
        if (request.abort.signal.aborted) throw new Error('提交已取消。');
        return send(command, { baseRevision, signal: request.abort.signal });
      })
      .then((receipt) => {
        if (pending.current !== request || !mounted.current) return;
        if (!receipt || typeof receipt.ok !== 'boolean')
          throw new Error('宿主没有返回有效提交回执。');
        if (!receipt.ok) {
          presentation.setNotice(receipt.message || '服务器拒绝了本次操作。');
          release(request);
          return;
        }
        if (!Number.isSafeInteger(receipt.revision) || receipt.revision <= baseRevision)
          throw new Error('宿主返回了无效的提交修订号，请重新同步局面。');
        request.acceptedRevision = receipt.revision;
        // A broadcast alone never unlocks a pending submission. A real ack AND its committed
        // snapshot are required, in either arrival order (including later opponent revisions).
        if (current.current.revision >= receipt.revision) release(request);
      })
      .catch((error: unknown) => {
        if (pending.current !== request || !mounted.current) return;
        presentation.setNotice(
          error instanceof Error ? error.message : '提交失败，请同步局面后重试。',
        );
        release(request);
      });
    return null;
  }
  const blocked = props.connection !== 'connected' || !!props.disabled || submitting;
  const interaction = useGameInteraction({
    state,
    current: () => current.current.view.state,
    submit,
    commandBlock,
    notify: presentation.setNotice,
    ownsReaction: !blocked && state.pending[0]?.owner === viewer,
    canChooseHand: !blocked && state.active === viewer,
    canChooseCustomSummon: !blocked && state.active === viewer,
    revision: update.revision,
  });
  return {
    ...presentation,
    ...interaction,
    match: LOCAL_MATCH,
    controller: viewer,
    modal,
    setModal: (value: GameModal) => {
      if (value !== 'new') setModal(value);
    },
    saveStatus: '由宿主管理',
    online: {
      viewer,
      connection: props.connection,
      submitting,
      blocked,
      revision: update.revision,
    },
  };
}
