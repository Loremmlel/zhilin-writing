import type { Session } from './history';
import { normalizeLegacyGuards } from '../core/protection';
import { refreshDeployment } from '../core/geometry';
import type { Player } from '../types';

/** 作者更正应用于每个快照，保持 v2 格式与存储键。 */
export function normalizeHornStorage(input: Session): Session {
  const session = structuredClone(input);
  for (const state of [
    session.present,
    ...session.past,
    ...session.future,
    ...(session.humanAnchor ? [session.humanAnchor] : []),
  ]) {
    normalizeLegacyGuards(state);
    for (const player of [1, 2] as Player[]) {
      refreshDeployment(state, player);
      state.hands[player] = state.hands[player].filter((card) => {
        if (card.kind !== 'u17') return true;
        card.expiresAt ??= card.drawnAt + 8;
        return card.expiresAt > state.turns[player];
      });
    }
  }
  return session;
}
