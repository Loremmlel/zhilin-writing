'use client';
import { GameSurface } from './GameSurface';
import type { HaojieGameProps } from './game/types';
import { useGameController } from './game/useGameController';
export type { HaojieGameProps } from './game/types';

/** Backward-compatible local entry: persistence, AI and initial props retain their existing meaning. */
export function HaojieGame(props: HaojieGameProps) {
  const game = useGameController(props);
  return <GameSurface game={game} local={game} />;
}
