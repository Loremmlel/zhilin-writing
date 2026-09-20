import { DIFFICULTIES } from './difficulty';
import { decisionOwner } from './observation';
import { getStats } from '../engine/state';
import type { GameState } from '../engine/types';
import type { Difficulty, SearchLimits } from './types';
export interface TurnBudget {
  ply: number;
  nodes: number;
  ms: number;
  commands: number;
}
export const emptyBudget = (): TurnBudget => ({ ply: -1, nodes: 0, ms: 0, commands: 0 });
/** Shared by browser scheduling and the command-line arena. Presentation delay is never charged. */
export function allocateBudget(
  s: GameState,
  difficulty: Difficulty,
  spent: TurnBudget,
): SearchLimits {
  const cfg = DIFFICULTIES[difficulty],
    owner = decisionOwner(s);
  const used = spent.ply === s.ply ? spent : emptyBudget();
  const activeUnits = s.units.filter((u) => {
    const st = getStats(s, u);
    return (
      u.owner === owner &&
      u.kind !== 'grave' &&
      u.kind !== 'wall' &&
      !st.sleeping &&
      !st.frozen &&
      !st.stunned &&
      (st.operationsLeft > 0 || u.mode === 'attack' || u.mode === 'move')
    );
  }).length;
  // Several actors can share a cached plan; don't exhaust the entire turn on its first three actors.
  const planningBatches = Math.max(1, Math.ceil(activeUnits / 3));
  return {
    mode: 'work',
    simulations: Math.floor(
      Math.max(
        difficulty === 'hard' ? 240 : difficulty === 'medium' ? 120 : 60,
        Math.min(cfg.nodes, (cfg.turnNodes - used.nodes) / planningBatches),
      ),
    ),
    milliseconds: Math.max(
      difficulty === 'hard' ? 90 : 45,
      Math.min(cfg.decisionMs, cfg.turnMs / planningBatches),
    ),
  };
}
