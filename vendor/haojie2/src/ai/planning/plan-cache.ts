import { fingerprint } from '../observation';
import type { Decision, Observation, PlanStep } from '../types';

/** 可复用预测行动，但预测的结束回合是新的决策边界。即使指纹相同，也须按实际剩余行动者和本回合预算重算。此处不模拟换回合或正式随机数。 */
export function cachedDecision(observation: Observation, plan: PlanStep[]): Decision | null {
  const next = plan[0];
  if (!next || next.command.type === 'end' || next.before !== fingerprint(observation)) return null;
  return {
    command: next.command,
    plan,
    stats: {
      simulations: 0,
      candidates: 0,
      depth: 0,
      replies: 0,
      sampled: 0,
      exhausted: false,
      cached: true,
    },
  };
}
