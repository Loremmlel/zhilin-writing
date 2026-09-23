import { HAOJIE_RULESET, PLAYER_VIEW_VERSION } from '../../engine/online/player-view';
import type { Command, PlayerView } from '../../engine';

export interface OnlineUpdate {
  matchId: string;
  /** 单调递增的房间修订号，不是 ply、serial 或存档格式版本。 */
  revision: number;
  kind: 'update' | 'snapshot';
  view: PlayerView;
}
export type CommandReceipt = { ok: true; revision: number } | { ok: false; message: string };
export interface CommandContext {
  baseRevision: number;
  /** 取消只停止界面等待，不回滚服务器已经提交的命令。 */
  signal: AbortSignal;
}
export interface HaojieOnlineGameProps {
  update: OnlineUpdate;
  connection: 'connecting' | 'connected' | 'disconnected';
  /** 宿主策略锁，不能仅根据当前回合所属方推导。 */
  disabled?: boolean;
  /** Optional host-owned consent flow; the board never restores local state. */
  onUndo?: () => void;
  canUndo?: boolean;
  error?: { id: string; message: string };
  /** 宿主生成 requestId、对重试去重、持久化结果并返回真实回执。 */
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
/** 重复或过期更新不能替换已接受的较新宿主快照。 */
export function selectOnlineUpdate(previous: OnlineUpdate, incoming: OnlineUpdate): OnlineUpdate {
  const error = updateError(incoming);
  if (error) throw new Error(error);
  if (incoming.matchId !== previous.matchId || incoming.view.viewer !== previous.view.viewer)
    throw new Error('更换对局或席位必须重新建立受控会话。');
  return incoming.revision > previous.revision ? incoming : previous;
}
