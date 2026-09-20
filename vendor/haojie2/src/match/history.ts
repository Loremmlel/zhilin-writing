import { redo, undo } from '../engine/history';
import type { Session } from '../engine/history';
import type { Command, GameState } from '../engine/types';
import { LOCAL_MATCH } from './settings';
export const matchSettings = (s: Session) => s.match ?? LOCAL_MATCH;
export const ownsComputerDecision = (s: Session) =>
  matchSettings(s).mode === 'ai' &&
  !s.present.winner &&
  (s.present.pending[0]?.owner ?? s.present.active) !== matchSettings(s).human;
const humanNode = (s: GameState, human: number) =>
  (s.pending[0]?.owner ?? s.active) === human && !s.winner;
/** Rewind a whole response to the most recent human decision, never only the AI's last atomic hit. */
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

/** Only the human's own free BW ability can interrupt an AI turn; engine still validates its cost/targets. */
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
