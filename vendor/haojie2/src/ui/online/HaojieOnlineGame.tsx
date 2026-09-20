'use client';
import './online.css';
import { GameSurface } from '../GameSurface';
import { useOnlineController } from './useOnlineController';
import { updateError, type HaojieOnlineGameProps } from './types';
export type { HaojieOnlineGameProps, OnlineUpdate, CommandContext, CommandReceipt } from './types';

function OnlineMatch(props: HaojieOnlineGameProps) {
  const game = useOnlineController(props);
  return <GameSurface game={game} online={game.online} />;
}
/** Updates do not remount the board. Only changing the actual match or authenticated seat resets it. */
export function HaojieOnlineGame(props: HaojieOnlineGameProps) {
  const error = updateError(props.update);
  if (error)
    return (
      <div className="hj-game" role="alert">
        {error}
      </div>
    );
  return <OnlineMatch key={`${props.update.matchId}:${props.update.view.viewer}`} {...props} />;
}
