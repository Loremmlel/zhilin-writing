/** Public embedding entry. Import engine/index directly when React is not needed. */
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
