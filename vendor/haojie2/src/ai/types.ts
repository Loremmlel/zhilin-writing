import type { PayloadAnalysis } from './threats';
import type { Command, GameState, Player } from '../engine/types';
export type Difficulty = 'easy' | 'medium' | 'hard';
/** No real seed, PRNG state, event history or logs cross the planning boundary. */
export type Observation = Omit<GameState, 'seed' | 'rng' | 'events' | 'log'>;
export interface SearchLimits {
  simulations: number;
  milliseconds: number;
  /** Work mode is reproducible; timed mode explicitly trades reproducibility for a deadline. */
  mode?: 'work' | 'timed';
  trace?: boolean;
}
export interface PlanStep {
  before: string;
  command: Command;
}
export interface CandidateTrace {
  command: Command;
  score: number;
  stage: 'static' | 'reply' | 'end-turn';
  line: Command[];
  outcomes: {
    probability: number;
    score: number;
    bases: Record<Player, number>;
    terms: Record<string, number>;
    payloads: PayloadAnalysis[];
  }[];
}
export interface Decision {
  command: Command | null;
  plan: PlanStep[];
  trace?: {
    initial: Record<string, number>;
    alternatives: CandidateTrace[];
    chosen: Command | null;
  };
  stats: {
    simulations: number;
    candidates: number;
    depth: number;
    replies: number;
    sampled: number;
    exhausted: boolean;
    mode?: 'work' | 'timed';
    stopReason?: 'nodes' | 'time' | 'complete';
    replyCandidates?: number;
    replySamples?: number;
    selectedDepth?: number;
    cached?: boolean;
    endTurnChecks?: number;
    endTurnImproved?: boolean;
  };
}
export interface SearchRequest {
  id: number;
  observation: Observation;
  side: Player;
  difficulty: Difficulty;
  limits?: Partial<SearchLimits>;
}
export interface SearchResponse {
  id: number;
  progress?: boolean;
  decision?: Decision;
  error?: string;
}
