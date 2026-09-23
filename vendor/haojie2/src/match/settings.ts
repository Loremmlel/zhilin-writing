import type { Player } from '../engine/types';
/** 对局元数据而非战斗状态；保存的模式不影响伤害或随机结果。 */
export interface MatchSettings {
  mode: 'local' | 'ai';
  rules?: 'classic' | 'shrine';
  human: Player;
  difficulty: 'easy' | 'medium' | 'hard';
}
export const LOCAL_MATCH: MatchSettings = { mode: 'local', human: 1, difficulty: 'medium' };
export function validMatch(v: unknown): v is MatchSettings {
  if (!v || typeof v !== 'object') return false;
  const m = v as MatchSettings;
  return (
    ['local', 'ai'].includes(m.mode) &&
    (m.rules === undefined || ['classic', 'shrine'].includes(m.rules)) &&
    [1, 2].includes(m.human) &&
    ['easy', 'medium', 'hard'].includes(m.difficulty)
  );
}
