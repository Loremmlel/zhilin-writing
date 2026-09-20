import { fingerprint } from './observation';
import type { Decision, Observation, PlanStep } from './types';

/** Predicted actions are reusable; a predicted END is a new decision boundary.
 * Re-search with the actual remaining actors and current turn budget, even when
 * the prediction's fingerprint matches. No turn-switch or real RNG is simulated here. */
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
