import type { Player } from '../engine/types';
/** Session metadata, not combat state: saved modes never influence damage or randomness. */
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
