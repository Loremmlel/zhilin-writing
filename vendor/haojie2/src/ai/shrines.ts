/** Strategic priors, not rule numbers. Draft policy never sees an opponent's commitment. */
import { definition } from '../engine/catalog';
import { canChooseSummon, selectableSummons } from '../engine/shrines';
import type { Command, GameState, Kind, Player } from '../engine/types';
import type { Decision } from './types';
import { fingerprint } from './observation';
export const auraValue: Partial<Record<Kind, number>> = {
  s9: 55,
  s10: 100,
  s11: 135,
  s13: 110,
  laoqian: 155,
};
const shrineEffects: Partial<Record<Kind, number>> = {
  s1: 70,
  s2: 65,
  s3: 85,
  s4: 80,
  s5: 110,
  s6: 70,
  s7: 65,
  s8: 95,
  s12: 75,
  s14: 85,
  s15: 80,
  s16: 45,
};
export function shrinePrior(kind: Kind): number {
  const d = definition(kind);
  return (
    auraValue[kind] ??
    (shrineEffects[kind] ?? 0) +
      Math.max(0, d.attack) * 1.1 +
      Math.max(0, d.health) * 0.5 +
      Math.min(8, d.range) * 2
  );
}
export function draftDecision(s: GameState, side: Player): Decision {
  const draft = s.shrineDraft;
  const kind =
    draft && !draft.committed[side]
      ? [...draft.offers[side]].sort((a, b) => shrinePrior(b) - shrinePrior(a))[0]
      : undefined;
  const command: Command | null = kind
    ? {
        type: 'choose-shrine',
        player: side,
        shrineKind: kind,
        ...(kind === 's9' ? { parity: 'odd' as const } : {}),
      }
    : null;
  return {
    command,
    plan: command ? [{ before: fingerprint(s), command }] : [],
    stats: {
      simulations: 0,
      candidates: kind ? 3 : 0,
      depth: 1,
      replies: 0,
      sampled: 0,
      exhausted: false,
    },
  };
}
/** Enumerate the actual source pool, preserving the random alternative and once/turn allowance. */
export function summonChoices(s: GameState, command: Command, ultimate: boolean): Command[] {
  if (!canChooseSummon(s)) return [command];
  const score = (kind: Kind) => {
    const d = definition(kind);
    return (
      Math.max(0, d.health) * 0.45 +
      Math.max(0, d.attack) * Math.max(1, d.actions) * 0.7 +
      Math.min(8, d.range) * 3 +
      (kind === 'u25' ? 115 : kind === 'u12' ? 150 : kind === 'u3' ? 40 : 0)
    );
  };
  return [
    command,
    ...selectableSummons(ultimate)
      .sort((a, b) => score(b) - score(a))
      .map((chosenKind) => ({ ...command, chosenKind })),
  ];
}
export function regularSummonCommands(s: GameState): Command[] {
  if (s.mode === 'shrine') return summonChoices(s, { type: 'summon', ultimate: true }, true);
  return [
    ...summonChoices(s, { type: 'summon', ultimate: false }, false),
    ...(s.heads[s.active] >= 2 ? summonChoices(s, { type: 'summon', ultimate: true }, true) : []),
  ];
}
