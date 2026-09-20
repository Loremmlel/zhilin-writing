/** Shared identity and per-ability resources. No UI policy or mutable global state. */
import { definition } from './catalog';
import type { AbilityCharge, GamePosition, Kind, Player, Unit } from './types';

export const abilityKinds = (u: Unit): Kind[] => [...new Set([u.kind, ...(u.traits ?? [])])];
export const hasTrait = (u: Unit, kind: Kind): boolean =>
  u.kind === kind || !!u.traits?.includes(kind);
export const anyTrait = (u: Unit, kinds: readonly Kind[]): boolean =>
  kinds.some((k) => hasTrait(u, k));
export const isLandmark = (u: Unit): boolean => !!definition(u.kind).landmark;
export const isShrine = (u: Unit): boolean => definition(u.kind).tier === 'shrine';
export const isMage = (u: Unit): boolean => abilityKinds(u).some((k) => !!definition(k).mage);
export const canDeployKind = (kind: Kind): boolean => {
  const d = definition(kind);
  return d.spell === undefined && d.weapon === undefined && !d.aura;
};
export const isFollower = (kind: Kind): boolean =>
  canDeployKind(kind) && !definition(kind).landmark && !['grave', 'wall'].includes(String(kind));
export const allPieces = (s: GamePosition): Unit[] => [
  ...s.units,
  ...(s.landmarks ?? []).filter((l) => l.hp > 0 && l.dormantSince === undefined),
];
export const aura = (s: GamePosition, p: Player, kind: Kind) =>
  s.auras?.[p].find((a) => a.kind === kind);
export const hasAura = (s: GamePosition, p: Player, kind: Kind): boolean => !!aura(s, p, kind);
export const ordinal = (kind: Kind): number | null => {
  if (typeof kind === 'number') return kind;
  if (kind === '3p') return 3;
  if (kind === '17p') return 17;
  const match = /^(?:u|s)(\d+)(?:p)?$/.exec(kind);
  return match ? Number(match[1]) : null;
};
export const signedAttack = (u: Unit): boolean => anyTrait(u, ['u21', 'sage', 's4', 's6']);
export const canAttackFriend = (u: Unit, target: Unit): boolean =>
  definition(u.kind).attack < 0 ||
  signedAttack(u) ||
  (!u.silenced && anyTrait(u, [2, 'u21', 'sage', 's5', 's14'])) ||
  (!target.silenced && anyTrait(target, [16, 's6']));
// Printed equipment restrictions survive silence; inherited restrictions apply as abilities.
export const refusesWeapons = (u: Unit): boolean => anyTrait(u, [10, 's7']);
export const refusesFriendlyAttackBuff = (u: Unit): boolean => anyTrait(u, [10, 's7']);
export const weaponHealth = (kind: Kind): number =>
  kind === 'u11' ? 25 : kind === 'u28' ? 5 : kind === 's2' ? 20 : kind === 's15' ? -5 : 0;

export function chargeFor(u: Unit, kind: Kind): AbilityCharge {
  if (kind === u.kind) return u;
  return (
    u.abilityCharges?.[kind] ?? {
      charge: 0,
      readyCharge: 0,
      chargeType: definition(kind).move % 1 ? 'move' : kind === 21 ? 'skill' : 'attack',
      lastCharge: -1,
    }
  );
}
export function withAbilityCharge<T>(u: Unit, kind: Kind, fn: () => T): T {
  if (kind === u.kind) return fn();
  const native: AbilityCharge = {
    charge: u.charge,
    readyCharge: u.readyCharge,
    chargeType: u.chargeType,
    lastCharge: u.lastCharge,
  };
  Object.assign(u, chargeFor(u, kind));
  try {
    return fn();
  } finally {
    (u.abilityCharges ??= {})[kind] = {
      charge: u.charge,
      readyCharge: u.readyCharge,
      chargeType: u.chargeType,
      lastCharge: u.lastCharge,
    };
    Object.assign(u, native);
  }
}
export function consumeCharge(u: Unit, kind: Kind) {
  withAbilityCharge(u, kind, () => {
    u.charge = u.readyCharge = 0;
  });
}
export const moveChargeKind = (u: Unit): Kind | undefined =>
  abilityKinds(u).find((k) => definition(k).move > 0 && definition(k).move % 1 !== 0);
export const attackChargeKind = (u: Unit): Kind | undefined =>
  abilityKinds(u).find((k) => definition(k).actions === 0.5);
