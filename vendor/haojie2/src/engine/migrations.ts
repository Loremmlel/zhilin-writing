import type { Session } from './history';
import { normalizeLegacyGuards } from './protection';
import type { Player } from './types';

/** Author corrections are applied to every snapshot, keeping the v2 format and storage key. */
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
      state.hands[player] = state.hands[player].filter((card) => {
        if (card.kind !== 'u17') return true;
        card.expiresAt ??= card.drawnAt + 8;
        return card.expiresAt > state.turns[player];
      });
    }
  }
  return session;
}
