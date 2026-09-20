import type { EventActor } from './event-facts';
import type {
  Aura,
  Card,
  ClockFrame,
  Effect,
  GameEvent,
  GamePosition,
  GameState,
  Landmark,
  Player,
  Point,
  ShrineDraft,
  Unit,
} from './types';
import { definition } from './catalog';
import { ensure } from './state';

/** Bump on rule changes; hosts must also pin the same source revision for both bundles. */
export const HAOJIE_RULESET = '3.0-feedback3' as const;
export const PLAYER_VIEW_VERSION = 1 as const;
export interface PlayerView {
  viewVersion: typeof PLAYER_VIEW_VERSION;
  ruleset: typeof HAOJIE_RULESET;
  viewer: Player;
  state: GamePosition;
}
const pick = <T extends object, K extends keyof T>(value: T, keys: readonly K[]): Pick<T, K> =>
  Object.fromEntries(keys.filter((k) => value[k] !== undefined).map((k) => [k, value[k]])) as Pick<
    T,
    K
  >;
const pair = <T, R>(value: Record<Player, T>, map: (v: T) => R): Record<Player, R> => ({
  1: map(value[1]),
  2: map(value[2]),
});
const point = (p: Point): Point => ({ x: p.x, y: p.y });
const effect = (v: Effect): Effect =>
  pick(v, ['type', 'from', 'until', 'owner', 'amount', 'sourceId', 'global']);
const card = (v: Card): Card =>
  pick(v, [
    'id',
    'kind',
    'drawnAt',
    'expiresAt',
    'group',
    'rerolled',
    'summonedPly',
    'summonPool',
    'parity',
  ]);
const knownKind = (key: string) => {
  try {
    return String(definition((/^\d+$/.test(key) ? Number(key) : key) as Unit['kind']).id) === key;
  } catch {
    return false;
  }
};
const kindMap = <T, R>(value: Partial<Record<Unit['kind'], T>>, map: (v: T) => R) =>
  Object.fromEntries(
    Object.entries(value)
      .filter(([k, v]) => knownKind(k) && v !== undefined)
      .map(([k, v]) => [k, map(v as T)]),
  );

/** Nested objects are projected too: clock snapshots and reaction sources are not escape hatches. */
function unit(v: Unit): Unit {
  return {
    ...pick(v, [
      'id',
      'kind',
      'owner',
      'x',
      'y',
      'hp',
      'maxHp',
      'size',
      'born',
      'offset',
      'deployedAt',
      'chargedOnDeploy',
      'mode',
      'operations',
      'shots',
      'moves',
      'bonusAttacks',
      'bonusSequence',
      'weaponFirstUsed',
      'charge',
      'readyCharge',
      'chargeType',
      'lastCharge',
      'upgrades',
      'kills',
      'attackBonus',
      'rangeBonus',
      'guardUsed',
      'rerollUsedPly',
      'silenced',
      'freeUsed',
      'onceUsed',
      'extraOperations',
      'bannerHp',
      'overMaxFromBanner',
      'bladeQualified',
      'group',
      'expiresAt',
      'hookReadyAt',
      'hookExpiresAt',
    ]),
    attacked: [...v.attacked],
    effects: v.effects.map(effect),
    equipment: [...v.equipment],
    ...(v.traits ? { traits: [...v.traits] } : {}),
    ...(v.guardSourceIds ? { guardSourceIds: [...v.guardSourceIds] } : {}),
    ...(v.abilityUsage
      ? { abilityUsage: kindMap(v.abilityUsage, (a) => pick(a, ['once', 'free'])) }
      : {}),
    ...(v.abilityCharges
      ? {
          abilityCharges: kindMap(v.abilityCharges, (a) =>
            pick(a, ['charge', 'readyCharge', 'chargeType', 'lastCharge']),
          ),
        }
      : {}),
    ...(v.equipmentIds ? { equipmentIds: kindMap(v.equipmentIds, (id) => id) } : {}),
    ...(v.receivedDamage
      ? { receivedDamage: v.receivedDamage.map((d) => pick(d, ['ply', 'amount'])) }
      : {}),
  };
}
const landmark = (v: Landmark): Landmark => ({
  ...unit(v),
  ...pick(v, ['dormantSince', 'rebuildTicks']),
});
const actor = (v: EventActor): EventActor => pick(v, ['id', 'owner', 'kind', 'size', 'x', 'y']);
const event = (v: GameEvent): GameEvent => ({
  ...pick(v, [
    'id',
    'type',
    'unitId',
    'owner',
    'amount',
    'text',
    'ultimate',
    'action',
    'stage',
    'ability',
    'causeId',
    'parentId',
  ]),
  ...(v.from ? { from: point(v.from) } : {}),
  ...(v.to ? { to: point(v.to) } : {}),
  ...(v.path ? { path: v.path.map(point) } : {}),
  ...(v.area ? { area: v.area.map(point) } : {}),
  ...(v.actor ? { actor: actor(v.actor) } : {}),
  ...(v.subject ? { subject: actor(v.subject) } : {}),
});
const frame = (v: ClockFrame): ClockFrame => ({
  ply: v.ply,
  turns: pair(v.turns, (n) => n),
  units: v.units.map(unit),
});

/** Shared with AI observations; before reveal only this viewer's actual choice is present. */
export function visibleShrineDraft(d: ShrineDraft, viewer: Player): ShrineDraft {
  const choices: ShrineDraft['choices'] = {};
  for (const p of [1, 2] as Player[]) {
    const c = d.choices[p];
    if (c && (d.revealed || p === viewer)) choices[p] = pick(c, ['kind', 'parity']);
  }
  return {
    offers: pair(d.offers, (v) => [...v]),
    committed: pair(d.committed, (v) => v),
    revealed: d.revealed,
    choices,
  };
}

/** Server-side projection, never spread GameState or a Session onto the wire. Public hands stay public. */
export function getPlayerView(s: GameState, viewer: Player): PlayerView {
  ensure(viewer === 1 || viewer === 2, '玩家视图需要有效席位。');
  const hiddenDraft = !!s.shrineDraft && !s.shrineDraft.revealed;
  const state: GamePosition = {
    version: s.version,
    serial: s.serial,
    ply: s.ply,
    active: s.active,
    phase: s.phase,
    summonSlots: s.summonSlots,
    turns: pair(s.turns, (v) => v),
    bases: pair(s.bases, (v) => v),
    baseEffects: pair(s.baseEffects, (v) => v.map(effect)),
    heads: pair(s.heads, (v) => v),
    hands: pair(s.hands, (v) => v.map(card)),
    bonus: pair(s.bonus, (v) => v),
    deployRows: pair(s.deployRows, (v) => [...v]),
    units: s.units.map(unit),
    pending: s.pending.map((r) => ({
      ...pick(r, ['kind', 'targetId', 'owner', 'amount']),
      source: unit(r.source),
    })),
    deaths: s.deaths.map((d) => pick(d, ['id', 'kind', 'owner', 'ply', 'revived', 'group'])),
    hazards: s.hazards.map((h) => pick(h, ['id', 'owner', 'sourceId', 'axis', 'line', 'due'])),
    siphons: s.siphons.map((v) => pick(v, ['id', 'sourceId', 'owner', 'fromId', 'toId'])),
    iceMarks: s.iceMarks.map((v) => pick(v, ['id', 'sourceId', 'owner', 'due', 'x', 'y'])),
    ...(s.mode ? { mode: s.mode } : {}),
    ...(s.landmarks ? { landmarks: s.landmarks.map(landmark) } : {}),
    ...(s.auras
      ? { auras: pair(s.auras, (v) => v.map((a: Aura) => pick(a, ['kind', 'parity', 'usedPly']))) }
      : {}),
    ...(s.regularSummons !== undefined ? { regularSummons: s.regularSummons } : {}),
    ...(s.summonOffer
      ? {
          summonOffer: {
            owner: s.summonOffer.owner,
            count: s.summonOffer.count,
            groups: s.summonOffer.groups.map((g) => g.map(card)),
          },
        }
      : {}),
    ...(s.shrineSetupDone ? { shrineSetupDone: [...s.shrineSetupDone] } : {}),
    ...(s.clockFrames
      ? {
          clockFrames: pair(s.clockFrames, (f) => ({
            ...(f.current ? { current: frame(f.current) } : {}),
            ...(f.previous ? { previous: frame(f.previous) } : {}),
          })),
        }
      : {}),
    ...(s.shrineDraft ? { shrineDraft: visibleShrineDraft(s.shrineDraft, viewer) } : {}),
    ...(s.winner ? { winner: s.winner } : {}),
    // Secret selection has a deliberately closed presentation vocabulary. Future engine debug
    // messages or event snapshots cannot accidentally reveal a choice through another channel.
    log: hiddenDraft
      ? [
          '第0回合 · 双方各抽3个神龛，锁定后同时揭示。',
          ...([1, 2] as Player[])
            .filter((p) => s.shrineDraft!.committed[p])
            .map((p) => `${p}方已锁定神龛。`),
        ]
      : [...s.log],
    events: hiddenDraft
      ? s.events.map((e) => ({ id: e.id, type: 'turn' as const, text: '神龛选择中' }))
      : s.events.map(event),
  };
  return { viewVersion: PLAYER_VIEW_VERSION, ruleset: HAOJIE_RULESET, viewer, state };
}
