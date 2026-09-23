import { redo, undo } from '../engine/session/history';
import type { Session } from '../engine/session/history';
import type { Command, GameState } from '../engine/types';
import { LOCAL_MATCH } from './settings';
export const matchSettings = (s: Session) => s.match ?? LOCAL_MATCH;
export const ownsComputerDecision = (s: Session) =>
  matchSettings(s).mode === 'ai' &&
  !s.present.winner &&
  (s.present.pending[0]?.owner ?? s.present.active) !== matchSettings(s).human;
const humanNode = (s: GameState, human: number) =>
  (s.pending[0]?.owner ?? s.active) === human && !s.winner;
/** 撤销整段电脑回应并回到最近的人类决策点，不只撤销 AI 最后一发原子命中。 */
export function rewindMatch(s: Session, forward = false): Session {
  if (matchSettings(s).mode === 'local') return forward ? redo(s) : undo(s);
  const human = matchSettings(s).human;
  if (!forward && s.humanAnchor && !s.past.some((state) => humanNode(state, human))) {
    return {
      ...s,
      present: s.humanAnchor,
      humanAnchor: undefined,
      past: [],
      future: [...s.past, s.present].slice(-60),
    };
  }
  let next = forward ? redo(s) : undo(s);
  while (next !== s && !humanNode(next.present, human) && !next.present.winner) {
    const after = forward ? redo(next) : undo(next);
    if (after === next) break;
    next = after;
  }
  if (next === s) return s;
  return {
    ...next,
    humanAnchor:
      forward && humanNode(s.present, human)
        ? s.present
        : [...next.past].reverse().find((state) => humanNode(state, human)),
  };
}

/** 只有人类自己的免费巨大化能打断 AI 回合；引擎仍验证费用和目标。 */
export function humanCommandAllowed(s: Session, c: Command): boolean {
  const match = matchSettings(s);
  if (match.mode === 'local') return true;
  const u = s.present.units.find((u) => u.id === c.unitId);
  if (c.unitId && u?.owner !== match.human) return false;
  if (!ownsComputerDecision(s)) return true;
  return (
    !s.present.pending.length &&
    c.type === 'skill' &&
    !!u &&
    u.owner === match.human &&
    (c.ability ?? u.kind) === 'u7'
  );
}
