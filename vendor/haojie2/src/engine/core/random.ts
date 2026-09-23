import type { GamePosition } from '../types';
/** 可选模拟接口，不进入序列化局面，正式对局不使用。 */
export type RandomSource = (boundaries: readonly number[]) => number;
const sources = new WeakMap<GamePosition, RandomSource>();
/**
 * 为单次同步规则调用临时绑定模拟源，成功或异常均解除绑定。
 * 回调不能跨异步边界；概率分界由规则提供，模拟源不能读取正式随机状态。
 */
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
