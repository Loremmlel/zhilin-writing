import {
  matchSettings,
  ownsComputerDecision,
  rewindMatch,
  humanCommandAllowed,
} from '../../../match/history';
import { LOCAL_MATCH, type MatchSettings } from '../../../match/settings';
import { useComputer } from '../../opponent/useComputer';
import { useRef, useState } from 'react';
import type { Session } from '../../../engine';
import { createDemoGame, createGame, createSession } from '../../../engine';
import { randomSeed, useGameSession } from '../../session/useGameSession';
import type { GameModal, HaojieGameProps } from './types';
import { useGameHotkeys } from './useGameHotkeys';
import { useGameInteraction } from './useGameInteraction';

/** 本地适配器持有 Session、AI 和历史；选点与表现由共享层处理。 */
export function useGameController(props: HaojieGameProps) {
  const game = useGameSession(props);
  const { session, live, setNotice } = game;
  const [modal, setModal] = useState<GameModal>(null);
  const [referenceOpen, setReferenceOpen] = useState(false);
  const cancelComputer = useRef<() => void>(() => {});
  const interaction = useGameInteraction({
    state: session.present,
    current: () => live.current.present,
    submit: (c) => game.execute(c).present,
    commandBlock: (c) =>
      humanCommandAllowed(live.current, c)
        ? null
        : c.type === 'end'
          ? '当前由AI决策。'
          : '当前操作不属于你；可查看棋盘或悔棋。',
    notify: setNotice,
    ownsReaction: !ownsComputerDecision(session),
    canChooseHand: !ownsComputerDecision(session),
    canChooseCustomSummon: !ownsComputerDecision(session),
    beforeSelection: () => {
      if (ownsComputerDecision(live.current)) cancelComputer.current();
    },
  });
  const computer = useComputer({
    session,
    live,
    apply: (c) => {
      game.execute(c);
      interaction.cancel();
      interaction.setSelectedId(c.unitId ?? null);
    },
    modal:
      referenceOpen ||
      interaction.choiceCommand ||
      (interaction.intent.kind === 'select' &&
        ownsComputerDecision(session) &&
        humanCommandAllowed(session, interaction.intent.draft))
        ? 'new'
        : modal,
    notice: setNotice,
  });
  cancelComputer.current = computer.cancel;
  function replace(next: Session, explicit = false) {
    computer.cancel();
    game.replace(next, explicit);
    interaction.reset();
  }
  function rewind(forward = false) {
    const next = rewindMatch(live.current, forward);
    if (next === live.current) return;
    replace(next);
    if (ownsComputerDecision(next)) computer.pause();
    setNotice(
      forward ? '已重做，随机结果保持不变。' : '已悔棋，人头、武器、效果计时与随机数全部恢复。',
    );
  }
  useGameHotkeys(interaction.scope, !!modal || referenceOpen, rewind, interaction.cancel);
  function importSession(next: Session) {
    replace(next, true);
    interaction.setSelectedId(null);
    computer.resume();
    setNotice('浩劫存档已载入，包含完整悔棋历史。');
  }
  function newGame(seedText: string, demo: boolean, match: MatchSettings = LOCAL_MATCH) {
    try {
      replace(
        createSession(
          demo
            ? createDemoGame()
            : createGame(
                seedText.trim() ? Number(seedText) : randomSeed(),
                match.rules ?? 'classic',
              ),
          match,
        ),
        true,
      );
      computer.resume();
      interaction.setSelectedId(null);
      setModal(null);
      setNotice(
        demo
          ? '已载入演示局，包含法师、装备、叠放军团和6人头。'
          : '浩劫新局开始。先召唤，再部署与行动。',
      );
    } catch (e) {
      setNotice(e instanceof Error ? e.message : '无法开始对局。');
    }
  }
  return {
    ...game,
    ...interaction,
    computer,
    match: matchSettings(session),
    controller: session.present.pending[0]?.owner ?? session.present.active,
    modal,
    setModal,
    setReferenceOpen,
    rewind,
    importSession,
    newGame,
    resumeComputer: () => {
      if (live.current.future.length) replace({ ...live.current, future: [] });
      computer.resume();
    },
  };
}
