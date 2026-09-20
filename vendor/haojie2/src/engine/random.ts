import type { GamePosition } from './types';
/** Optional simulation port. It never lives in serialized state and is never used by real play. */
export type RandomSource = (boundaries: readonly number[]) => number;
const sources = new WeakMap<GamePosition, RandomSource>();
export function withRandomSource<T>(
  state: GamePosition,
  source: RandomSource | undefined,
  run: () => T,
): T {
  if (source) sources.set(state, source);
  try {
    return run();
  } finally {
    sources.delete(state);
  }
}
export function simulationRandom(
  state: GamePosition,
  boundaries: readonly number[],
): number | undefined {
  const source = sources.get(state);
  if (!source) return undefined;
  const value = source(boundaries);
  if (!Number.isFinite(value) || value < 0 || value >= 1)
    throw new Error('Random source must return a value in [0, 1).');
  return value;
}
