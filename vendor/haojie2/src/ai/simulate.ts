import { applyCommand } from '../engine/game';
import { RuleError } from '../engine/state';
import type { Command, GameState } from '../engine/types';
import { hash, positionKey } from './observation';
export interface Outcome {
  state: GameState;
  weight: number;
}
export interface Distribution {
  outcomes: Outcome[];
  sampled: boolean;
  attempts: number;
}
class Chance extends Error {
  constructor(readonly cuts: readonly number[]) {
    super('chance');
  }
}
/** Exact small chance trees; stratified independent samples when the chance tree is too large.
 * A search path stops at this chance boundary rather than choosing its most fortunate child. */
export function distribution(
  s: GameState,
  c: Command,
  limit = 12,
  samples = 3,
  salt = 0,
  sampleKey?: string,
): Distribution {
  let attempts = 0;
  const run = (tape: readonly number[], fallback?: (cuts: readonly number[]) => number) => {
    let i = 0;
    attempts++;
    const result = applyCommand(s, c, (cuts) => {
      if (i < tape.length) return tape[i++];
      if (fallback) return fallback(cuts);
      const unique = [...new Set(cuts)].sort((a, b) => a - b);
      if (unique.length === 2) return (unique[0] + unique[1]) / 2;
      throw new Chance(unique);
    });
    result.log = [];
    result.events = [];
    return result;
  };
  const queue = [{ tape: [] as number[], weight: 1 }],
    outcomes: Outcome[] = [];
  let sampled = false;
  try {
    while (queue.length) {
      const branch = queue.shift()!;
      try {
        outcomes.push({ state: run(branch.tape), weight: branch.weight });
      } catch (e) {
        if (!(e instanceof Chance)) throw e;
        if (
          (e.cuts.length > 5 &&
            !(c.type === 'summon' && limit >= 40 && branch.tape.length === 0)) ||
          queue.length + outcomes.length + e.cuts.length > limit ||
          branch.tape.length >= 6
        ) {
          sampled = true;
          break;
        }
        for (let i = 1; i < e.cuts.length; i++) {
          queue.push({
            tape: [...branch.tape, (e.cuts[i - 1] + e.cuts[i]) / 2],
            weight: branch.weight * (e.cuts[i] - e.cuts[i - 1]),
          });
        }
      }
    }
    if (sampled) {
      outcomes.length = 0;
      const seed = hash(
        sampleKey === undefined ? positionKey(s) + JSON.stringify(c) + salt : sampleKey,
      );
      for (let lane = 0; lane < samples; lane++) {
        let index = 0;
        outcomes.push({
          state: run([], () => {
            // Common independent strata: never read state.rng, never condition on a future roll.
            const jitter = (hash(`${seed}:${index++}:${lane}`) + 0.5) / 4294967296;
            return index === 1 ? (lane + jitter) / samples : jitter;
          }),
          weight: 1 / samples,
        });
      }
    }
    const grouped = new Map<string, Outcome>();
    for (const out of outcomes) {
      const k = positionKey(out.state),
        old = grouped.get(k);
      if (old) old.weight += out.weight;
      else grouped.set(k, out);
    }
    return { outcomes: [...grouped.values()], sampled, attempts };
  } catch (e) {
    if (e instanceof RuleError) return { outcomes: [], sampled, attempts };
    throw e;
  }
}
