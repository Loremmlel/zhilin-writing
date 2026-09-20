import type { MatchSettings } from '../../match/settings';
import type { GameState } from '../../engine';
export type GameModal = 'rules' | 'codex' | 'new' | 'log' | null;
export interface HaojieGameProps {
  initialState?: GameState;
  initialMatch?: MatchSettings;
  storageKey?: string | null;
  onStateChange?: (state: GameState) => void;
}
