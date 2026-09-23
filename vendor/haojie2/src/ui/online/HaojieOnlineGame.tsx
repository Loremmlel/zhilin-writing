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
/** 普通更新不重新挂载棋盘；仅更换实际对局或已认证席位时重置。 */
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
