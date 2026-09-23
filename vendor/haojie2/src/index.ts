/** 公开嵌入入口；不需要 React 时直接导入 engine/index。 */
export * from './engine';
export { HaojieGame } from './ui/Game';
export type { HaojieGameProps } from './ui/Game';

export type { MatchSettings } from './match/settings';

export { HaojieOnlineGame } from './ui/online/HaojieOnlineGame';
export type {
  HaojieOnlineGameProps,
  OnlineUpdate,
  CommandReceipt,
  CommandContext,
} from './ui/online/types';
