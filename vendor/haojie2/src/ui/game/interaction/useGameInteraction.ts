import { useEffect, useMemo, useRef, useState } from 'react';
import type { ActionSpec, Command, GamePosition, Player, Point } from '../../../engine';
import {
  actionError,
  allPieces,
  cardActions,
  canChooseSummon,
  commandSummonPool,
  landmarkAt,
  occupants,
  queryCommandError,
  reactionAction,
  targetAt,
  unitActions,
} from '../../../engine';
import type { Intent } from './selection';
import { advanceIntent, canChoose, commandFor, startIntent } from './selection';

export interface InteractionSource {
  state: GamePosition;
  current: () => GamePosition;
  /** 本地适配器同步返回提交后的局面；受控适配器在宿主更新前返回 null。 */
  submit: (c: Command) => GamePosition | null;
  commandBlock: (c: Command) => string | null;
  notify: (message: string) => void;
  ownsReaction: boolean;
  canChooseHand: boolean;
  canChooseCustomSummon: boolean;
  handPlayer?: Player;
  beforeSelection?: () => void;
  /** 仅受控更新使未完成选点失效；本地连招保留原语义。 */
  revision?: number;
}

/** 两种局面来源共用一个交互控制器，不持有 Session、随机源、传输或历史。 */
export function useGameInteraction(source: InteractionSource) {
  const latest = useRef(source);
  latest.current = source;
  const scope = useRef<HTMLDivElement>(null);
  const [intent, setIntent] = useState<Intent>({ kind: 'none' });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cardId, setCardId] = useState<string | null>(null);
  const [choiceCommand, setChoiceCommand] = useState<Command | null>(null);
  const revision = useRef(source.revision);
  const s = source.state;
  const hand = s.hands[source.handPlayer ?? s.active];
  const unit = allPieces(s).find((u) => u.id === selectedId);
  const card = hand.find((c) => c.id === cardId);
  const reaction = s.pending[0];
  const activeIntent = reaction && source.ownsReaction ? startIntent(reactionAction(s)!) : intent;
  const actions = useMemo(
    () =>
      (card ? cardActions(s, card) : unit ? unitActions(s, unit) : []).filter(
        (a) => !source.commandBlock(a.command),
      ),
    [s, card, unit, source.commandBlock],
  );
  const endError = source.commandBlock({ type: 'end' }) ?? queryCommandError(s, { type: 'end' });
  useEffect(() => {
    if (source.revision === undefined || source.revision === revision.current) return;
    revision.current = source.revision;
    setIntent({ kind: 'none' });
    setCardId(null);
    setChoiceCommand(null);
    setSelectedId((id) => (allPieces(source.state).some((u) => u.id === id) ? id : null));
  }, [source.revision, source.state]);

  function cancel() {
    setIntent({ kind: 'none' });
    setCardId(null);
  }
  function reset() {
    cancel();
    setChoiceCommand(null);
  }
  function executeRun(c: Command) {
    const api = latest.current;
    const blocked = api.commandBlock(c);
    if (blocked) {
      api.notify(blocked);
      return;
    }
    try {
      const before = api.current();
      const next = api.submit(c);
      api.notify('');
      setCardId(null);
      setIntent({ kind: 'none' });
      if (c.type === 'end' || c.type === 'begin') setSelectedId(null);
      // 只有本地来源同步返回结果；远程交互不能猜测权威结果。
      if (!next) return;
      if (c.type === 'deploy' || c.type === 'synthesize')
        setSelectedId(next.events.find((e) => e.type === 'spawn')?.unitId ?? null);
      const id = c.unitId ?? (c.type === 'react' ? before.pending[0]?.source.id : undefined);
      const u = allPieces(next).find((u) => u.id === id);
      if (u && !next.pending.length && (u.mode === 'attack' || u.mode === 'move')) {
        const a = unitActions(next, u).find((a) => a.id === u.mode);
        if (a && !actionError(next, a)) setIntent(startIntent(a));
      }
    } catch (e) {
      api.notify(e instanceof Error ? e.message : '操作失败，当前局面没有改变。');
    }
  }
  function run(c: Command) {
    const api = latest.current;
    const blocked = api.commandBlock(c);
    if (blocked) {
      api.notify(blocked);
      return;
    }
    const state = api.current();
    if (api.canChooseCustomSummon && commandSummonPool(state, c) && canChooseSummon(state)) {
      setChoiceCommand(c);
      return;
    }
    executeRun(c);
  }
  function chooseAction(a: ActionSpec) {
    const api = latest.current;
    if (api.commandBlock(a.command)) return;
    const error = actionError(api.current(), a);
    if (error) {
      api.notify(error);
      return;
    }
    if (!a.steps.length) run(a.command);
    else {
      api.beforeSelection?.();
      setIntent(startIntent(a));
    }
  }
  function chooseCard(id: string) {
    const api = latest.current,
      state = api.current();
    if (state.pending.length || !api.canChooseHand) return;
    const c = state.hands[api.handPlayer ?? state.active].find((v) => v.id === id);
    if (!c) return;
    setCardId(id);
    setSelectedId(null);
    setIntent({ kind: 'none' });
    const candidates = cardActions(state, c);
    if (
      candidates.length === 1 &&
      candidates[0].steps.length &&
      !api.commandBlock(candidates[0].command) &&
      !actionError(state, candidates[0])
    )
      setIntent(startIntent(candidates[0]));
  }
  function onCell(p: Point) {
    const api = latest.current,
      state = api.current();
    if (activeIntent.kind === 'none') {
      const land = landmarkAt(state, p);
      const stack = [...occupants(state, p), ...(land ? [land] : [])];
      if (stack.length > 1) {
        const idx = stack.findIndex((u) => u.id === selectedId);
        setSelectedId(stack[(idx + 1) % stack.length].id);
      } else setSelectedId(stack[0]?.id ?? targetAt(state, p)?.id ?? null);
      setCardId(null);
      return;
    }
    const blocked = api.commandBlock(activeIntent.draft);
    if (blocked) {
      api.notify(blocked);
      return;
    }
    if (!canChoose(state, activeIntent, p)) {
      const c = commandFor(state, activeIntent, p);
      const error = c ? queryCommandError(state, c) : null;
      api.notify(error ?? '请选择高亮目标；技能的选点顺序显示在棋盘上方。');
      return;
    }
    const c = commandFor(state, activeIntent, p);
    if (c) run(c);
    else setIntent(advanceIntent(activeIntent, p, state));
  }
  return {
    scope,
    state: s,
    intent,
    activeIntent,
    selectedId,
    cardId,
    actions,
    endError,
    choiceCommand,
    setSelectedId,
    setIntent,
    cancel,
    reset,
    run,
    chooseAction,
    chooseCard,
    onCell,
    cancelChoice: () => setChoiceCommand(null),
    confirmChoice: (c: Command) => {
      setChoiceCommand(null);
      executeRun(c);
    },
  };
}
export type GameInteraction = ReturnType<typeof useGameInteraction>;
