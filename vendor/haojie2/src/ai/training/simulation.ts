import { applyCommand } from '../../engine/commands/game';
import { actorCommandError, parseCommand } from '../../engine/online/authority';
import { ensure } from '../../engine/core/state';
import type { Player } from '../../engine/types';
import { imagined, observe } from '../observation';
import { distribution } from '../simulation/simulate';
import type { Observation } from '../types';
import { trainingPosition } from './queries';

/** 独立模拟序列；调用方传入实验采样编号，不能使用正式对局的 seed/rng。 */
export function simulationRandomSource(sampleSeed: number) {
  ensure(
    Number.isSafeInteger(sampleSeed) && sampleSeed >= 0 && sampleSeed <= 0xffffffff,
    'sampleSeed 必须是 uint32。',
  );
  let value = sampleSeed;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let n = Math.imul(value ^ (value >>> 15), value | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

function prepare(observation: Observation, actor: Player, input: unknown) {
  const s = trainingPosition(observation);
  ensure(s.phase !== 'shrine-draft', '暗选需要信息集策略；不能补造另一方秘密选择后模拟。');
  const command = parseCommand(input);
  const error = actorCommandError(s, actor, command);
  ensure(!error, error ?? '操作者无权模拟此命令。');
  return { state: imagined(observation), command };
}

/** 一次生成式随机转移；只返回公开观察，不连接环境、不修改输入或正式随机序列。 */
export function sampleTrainingTransition(
  observation: Observation,
  actor: Player,
  input: unknown,
  sampleSeed: number,
) {
  const { state, command } = prepare(observation, actor, input);
  return observe(applyCommand(state, command, simulationRandomSource(sampleSeed)));
}

/** 小分支精确枚举，大分支明确标记 sampled，调用方不能把采样结果当成完整概率树。 */
export function trainingDistribution(
  observation: Observation,
  actor: Player,
  input: unknown,
  sampleSeed: number,
) {
  simulationRandomSource(sampleSeed);
  const { state, command } = prepare(observation, actor, input);
  const result = distribution(state, command, 12, 3, sampleSeed);
  return {
    sampled: result.sampled,
    attempts: result.attempts,
    outcomes: result.outcomes.map(({ state: next, weight }) => ({
      observation: observe(next),
      weight,
    })),
  };
}
