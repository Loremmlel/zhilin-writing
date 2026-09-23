'use client';
import { GameSurface } from './GameSurface';
import type { HaojieGameProps } from './game/interaction/types';
import { useGameController } from './game/interaction/useGameController';
export type { HaojieGameProps } from './game/interaction/types';

/** 向后兼容的本地入口，持久化、AI 和初始参数语义保持不变。 */
export function HaojieGame(props: HaojieGameProps) {
  const game = useGameController(props);
  return <GameSurface game={game} local={game} />;
}
