import { HAOJIE_RULESET, PLAYER_VIEW_VERSION } from '../../engine/player-view';
import type { Command, PlayerView } from '../../engine';

export interface OnlineUpdate {
  matchId: string;
  /** Monotonic room revision, not ply, serial or the save schema version. */
  revision: number;
  kind: 'update' | 'snapshot';
  view: PlayerView;
}
export type CommandReceipt = { ok: true; revision: number } | { ok: false; message: string };
export interface CommandContext {
  baseRevision: number;
  /** Cancellation stops UI waiting; it does not roll back an already committed server command. */
  signal: AbortSignal;
}
export interface HaojieOnlineGameProps {
  update: OnlineUpdate;
  connection: 'connecting' | 'connected' | 'disconnected';
  /** Host policy lock, never derive this solely from whose turn it is. */
  disabled?: boolean;
  error?: { id: string; message: string };
  /** Host generates requestId, deduplicates retries, persists the result, and resolves a real ack. */
  onCommand: (command: Command, context: CommandContext) => Promise<CommandReceipt>;
}
export function updateError(update: OnlineUpdate): string | null {
  if (
    !update ||
    typeof update.matchId !== 'string' ||
    !update.matchId ||
    !Number.isSafeInteger(update.revision) ||
    update.revision < 0 ||
    !['update', 'snapshot'].includes(update.kind)
  )
    return '宿主局面更新格式不正确。';
  if (update.view?.viewVersion !== PLAYER_VIEW_VERSION || update.view.ruleset !== HAOJIE_RULESET)
    return '游戏规则或视图版本不一致，请刷新页面并让宿主同步版本。';
  if (update.view.viewer !== 1 && update.view.viewer !== 2) return '宿主没有提供有效的玩家席位。';
  if (
    !update.view.state ||
    typeof update.view.state !== 'object' ||
    'seed' in update.view.state ||
    'rng' in update.view.state
  )
    return '受控棋盘只接受玩家视图，不能传入完整权威状态。';
  return null;
}
/** Duplicate or older updates never replace a newer accepted host snapshot. */
export function selectOnlineUpdate(previous: OnlineUpdate, incoming: OnlineUpdate): OnlineUpdate {
  const error = updateError(incoming);
  if (error) throw new Error(error);
  if (incoming.matchId !== previous.matchId || incoming.view.viewer !== previous.view.viewer)
    throw new Error('更换对局或席位必须重新建立受控会话。');
  return incoming.revision > previous.revision ? incoming : previous;
}
