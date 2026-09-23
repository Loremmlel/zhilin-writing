import { DIFFICULTIES } from './difficulty';
import { decisionOwner } from './observation';
import { getStats } from '../engine/core/state';
import type { GameState } from '../engine/types';
import type { Difficulty, SearchLimits } from './types';
export interface TurnBudget {
  ply: number;
  nodes: number;
  ms: number;
  commands: number;
}
export const emptyBudget = (): TurnBudget => ({ ply: -1, nodes: 0, ms: 0, commands: 0 });
/** 浏览器调度和命令行对战共用预算分配；展示延迟不计入计算预算。 */
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
  // 多个行动者可共用缓存计划，不能让前三个行动者耗尽整回合预算。
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
