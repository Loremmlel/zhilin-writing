import {
  allPieces,
  hasTrait,
  anyTrait,
  isLandmark,
  isMage,
  signedAttack,
  chargeFor,
  attackChargeKind,
  refusesFriendlyAttackBuff,
} from './traits';
import {
  bannerCount,
  consumeChosenSummon,
  onLandmarkDeployment,
  syncBanners,
} from '../setup/shrines';
import { attackPath } from './geometry';
import { enrichEvent } from './event-facts';
import { simulationRandom } from './random';
import { COMBAT_RULES, definition, isStored, SUMMON_POOL, ULTIMATE_POOL } from '../catalog';
import type {
  Card,
  Command,
  Effect,
  GameEvent,
  GamePosition,
  Kind,
  Mode,
  Player,
  Point,
  Stats,
  Target,
  Unit,
} from '../types';
export class RuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuleError';
  }
}
export function ensure(value: unknown, message: string): asserts value {
  if (!value) throw new RuleError(message);
}
export const faction = (p: Player) => (p === 1 ? '苍穹方' : '赤焰方');
export const now = (s: GamePosition, u: Unit) => s.ply + u.offset;
export const effectClock = (s: GamePosition, e: Effect, u?: Unit) =>
  e.global || !u ? s.ply : now(s, u);
export const activeEffect = (s: GamePosition, e: Effect, u?: Unit) =>
  e.from <= effectClock(s, e, u) && e.until > effectClock(s, e, u);
export const has = (s: GamePosition, u: Unit, type: Effect['type']) =>
  u.effects.some((e) => e.type === type && activeEffect(s, e, u));
// 墓地保留来源 owner 兼容旧档与因果记录，实际阵营始终为中立。
export const allegiance = (_s: GamePosition, u: Unit): Player | 0 =>
  u.kind === 'grave' ? 0 : u.owner;
export const passive = (_s: GamePosition, u: Unit) => !u.silenced;
export const hasWeapon = (u: Unit, k: Kind) => u.equipment.includes(k);
export const age = (s: GamePosition, u: Unit) => s.turns[u.owner] + u.offset / 2 - u.born;
export const isRunner = (u: Unit) => !u.silenced && anyTrait(u, ['u12', 'u12p']);
export function emit(s: GamePosition, event: Omit<GameEvent, 'id'>, message?: string) {
  const snap = enrichEvent(s, { ...event, id: `e${s.serial++}` });
  if (event.from) snap.from = { x: event.from.x, y: event.from.y };
  if (event.to) snap.to = { x: event.to.x, y: event.to.y };
  if (event.path) snap.path = event.path.map((p) => ({ x: p.x, y: p.y }));
  s.events.push(snap);
  if (message) {
    s.log.push(`${s.ply} · ${message}`);
    if (s.log.length > 180) s.log.shift();
  }
}
export function random(s: GamePosition, boundaries: readonly number[] = [0, 1]) {
  const supplied = simulationRandom(s, boundaries);
  if (supplied !== undefined) return supplied;
  ensure('rng' in s && typeof s.rng === 'number', '随机结算需要完整权威状态。');
  let x = s.rng;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  const next = x >>> 0;
  s.rng = next;
  return next / 4294967296;
}
export function template(kind: Kind, owner: Player, born: number, at: Point, id = 'preview'): Unit {
  const d = definition(kind);
  return {
    id,
    kind,
    owner,
    x: at.x,
    y: at.y,
    hp: d.health,
    maxHp: d.health,
    size: d.size ?? 1,
    born,
    offset: 0,
    deployedAt: 0,
    chargedOnDeploy: ['u1', 'u12', 'u12p'].includes(String(kind)),
    mode: 'none',
    operations: 0,
    shots: 0,
    moves: 0,
    attacked: [],
    bonusAttacks: 0,
    bonusSequence: false,
    weaponFirstUsed: false,
    charge: 0,
    readyCharge: 0,
    chargeType: d.move % 1 ? 'move' : kind === 21 ? 'skill' : 'attack',
    lastCharge: -1,
    upgrades: 0,
    kills: 0,
    attackBonus: 0,
    rangeBonus: 0,
    guardUsed: false,
    effects: [],
    equipment: [],
    silenced: false,
    freeUsed: -1,
    onceUsed: false,
  };
}
export function addUnit(
  s: GamePosition,
  kind: Kind,
  owner: Player,
  at: Point,
  group?: string,
  charge = false,
): Unit {
  const u = template(kind, owner, s.turns[owner], at, `u${s.serial++}`);
  u.deployedAt = s.ply;
  if (group) u.group = group;
  if (['u1', 'u12', 'u12p'].includes(String(kind))) u.born--;
  if (kind === 1 && charge) {
    u.hp -= 10;
    u.maxHp -= 10;
    u.born--;
    u.chargedOnDeploy = true;
  }
  if (isLandmark(u)) (s.landmarks ??= []).push(u);
  else s.units.push(u);
  onLandmarkDeployment(s, u);
  syncBanners(s);
  emit(
    s,
    { type: 'spawn', to: at, unitId: u.id, owner, ultimate: definition(kind).tier !== 'normal' },
    `${faction(owner)}部署${definition(kind).name}`,
  );
  return u;
}
export function draw(
  s: GamePosition,
  owner: Player,
  count: number,
  ultimate = false,
  chosenKind?: Kind,
): Card[] {
  const result: Card[] = [];
  if (chosenKind !== undefined) consumeChosenSummon(s, owner, chosenKind, ultimate);
  for (let i = 0; i < count; i++) {
    const pool = ultimate ? ULTIMATE_POOL : SUMMON_POOL;
    let kind =
      i === 0 && chosenKind !== undefined
        ? chosenKind
        : pool[
            Math.floor(
              random(
                s,
                Array.from({ length: pool.length + 1 }, (_, i) => i / pool.length),
              ) * pool.length,
            )
          ];
    const chosen = i === 0 && chosenKind !== undefined;
    if (!chosen && kind === 3 && random(s, [0, 1 / 3, 1]) >= 1 / 3) kind = '3p';
    if (
      !chosen &&
      kind === 17 &&
      random(s, [0, COMBAT_RULES.goldSpellChance, 1]) >= COMBAT_RULES.goldSpellChance
    )
      kind = '17p';
    if (!chosen && kind === 'u12' && random(s, [0, 0.1, 1]) >= 0.1) kind = 'u12p';
    const group = kind === 'u25' ? `group${s.serial++}` : undefined;
    const d = definition(kind),
      limit = d.spell ?? d.weapon;
    for (let j = 0; j < (group ? 8 : 1); j++) {
      const c: Card = {
        id: `c${s.serial++}`,
        kind,
        drawnAt: s.turns[owner],
        summonedPly: s.ply,
        summonPool: ultimate ? 'ultimate' : 'normal',
        ...(limit !== undefined && limit >= 0 ? { expiresAt: s.turns[owner] + limit } : {}),
        ...(group ? { group } : {}),
      };
      s.hands[owner].push(c);
      result.push(c);
    }
    emit(
      s,
      { type: 'summon', owner, text: d.name, ultimate },
      `${ultimate ? '终极' : '普通'}召唤：${d.name}${group ? ' ×8' : ''}`,
    );
  }
  return result;
}
export const piercing = (u: Unit) => hasWeapon(u, 'u28') || (hasTrait(u, 'slayer') && !u.silenced);
export const healingAttack = (u: Unit) =>
  definition(u.kind).attack < 0 ||
  signedAttack(u) ||
  (!u.silenced && anyTrait(u, [2, 'u21', 's14']));
export const counterChance = (u: Unit) =>
  hasTrait(u, 'archmage') ? COMBAT_RULES.archmageCounterChance : hasTrait(u, 'u3') ? 1 / 3 : 0;
/** 反制资格由结算和展示共用；万法真君及其继承能力在冰冻期间停用，普通反制不受影响。 */
export const canCounterSpell = (s: GamePosition, u: Unit): boolean =>
  counterChance(u) > 0 && passive(s, u) && !(hasTrait(u, 'archmage') && has(s, u, 'freeze'));
/** 射程不能依赖光环攻击加成，避免贤者之间递归调用 getStats。 */
export function attackAuraSources(s: GamePosition, target: Unit): Unit[] {
  if (allegiance(s, target) !== target.owner || refusesFriendlyAttackBuff(target)) return [];
  return s.units.filter(
    (u) =>
      hasTrait(u, 'sage') &&
      u.owner === target.owner &&
      passive(s, u) &&
      attackPath(
        s,
        u,
        asTarget(target),
        definition(u.kind).range +
          u.rangeBonus +
          (hasWeapon(u, 'u5') || hasWeapon(u, 's16') ? 1 : 0),
      ),
  );
}
export function getStats(s: GamePosition, u: Unit): Stats {
  const d = definition(u.kind),
    enabled = !u.silenced;
  let attack = d.attack + u.attackBonus,
    range = d.range + u.rangeBonus,
    actions = isLandmark(u) ? 1 : d.actions > 0 && d.actions < 1 ? 1 : d.actions,
    move = d.move;
  const frozen = has(s, u, 'freeze'),
    stunned = has(s, u, 'stun');
  const a = age(s, u);
  const sleeping = isLandmark(u) ? u.hp <= 0 : a <= 0 || (enabled && hasTrait(u, 23) && a < 2);
  if (enabled && hasTrait(u, '3p')) {
    const n = s.units.filter((v) => {
      for (let dx = 0; dx < v.size; dx++)
        for (let dy = 0; dy < v.size; dy++)
          if (Math.max(Math.abs(v.x + dx - u.x), Math.abs(v.y + dy - u.y)) <= 1) return true;
      return false;
    }).length;
    attack = Math.max(0, 40 - 5 * n) + u.attackBonus;
    range = n + u.rangeBonus;
  }
  if (enabled && hasTrait(u, 4) && chargeFor(u, 4).charge >= 5) range++;
  if (enabled && hasTrait(u, 15) && chargeFor(u, 15).chargeType === 'attack') {
    attack += chargeFor(u, 15).charge * COMBAT_RULES.accumulator.attack;
    range += chargeFor(u, 15).charge * COMBAT_RULES.accumulator.range;
  }
  if (enabled && hasTrait(u, 'u2')) attack += chargeFor(u, 'u2').charge * 15;
  if (enabled && hasTrait(u, 'u6') && hasWeapon(u, 'u5')) attack = 10 + u.attackBonus;
  if (hasWeapon(u, 'u5') || hasWeapon(u, 's16')) range++;
  if (hasWeapon(u, 's2') || hasWeapon(u, 's15')) attack += 20;
  if (hasWeapon(u, 'u11')) attack += 5;
  if (
    enabled &&
    hasTrait(u, 12) &&
    s.units.some(
      (v) =>
        allegiance(s, v) !== u.owner &&
        v.id !== u.id &&
        Array.from({ length: u.size * u.size }, (_, i) => ({
          x: u.x + (i % u.size),
          y: u.y + Math.floor(i / u.size),
        })).some((p) =>
          Array.from({ length: v.size * v.size }, (_, i) => ({
            x: v.x + (i % v.size),
            y: v.y + Math.floor(i / v.size),
          })).some((q) => Math.abs(p.x - q.x) + Math.abs(p.y - q.y) === 1),
        ),
    )
  ) {
    actions--;
    move--;
  }
  attack += u.effects
    .filter((e) => e.type === 'attack' && activeEffect(s, e, u))
    .reduce((a, e) => a + (e.amount ?? 0), 0);
  attack += attackAuraSources(s, u).length * COMBAT_RULES.sageAuraAttack;
  if (!refusesFriendlyAttackBuff(u) && allegiance(s, u) === u.owner)
    attack += bannerCount(s, u.owner) * 10;
  if (has(s, u, 'inner-fire')) attack = u.hp;
  if (definition(u.kind).attack < 0 || (enabled && hasTrait(u, 's14'))) attack = -20;
  const operationLimit =
    (enabled && hasTrait(u, 'u27') && a === 1 ? 2 : 1) + (u.extraOperations ?? 0);
  const locked = sleeping || frozen || stunned;
  const operationsLeft = locked ? 0 : Math.max(0, operationLimit - u.operations);
  const chargeKind = attackChargeKind(u),
    reserve = chargeKind === undefined ? undefined : chargeFor(u, chargeKind);
  const halfAttackLocked =
    !!reserve && !(reserve.chargeType === 'attack' && reserve.readyCharge >= 1);
  const availableAttack =
    locked || halfAttackLocked || (enabled && hasTrait(u, 'firelord'))
      ? 0
      : u.mode === 'attack'
        ? Math.max(0, actions - u.shots)
        : u.mode === 'none' && (operationsLeft > 0 || u.bonusAttacks > 0)
          ? actions
          : 0;
  return {
    attack:
      attack < 0 && (definition(u.kind).attack < 0 || (enabled && hasTrait(u, 's14')))
        ? -20
        : Math.max(0, attack),
    range: Math.max(0, range),
    actions: Math.max(0, actions),
    remaining: availableAttack,
    move,
    mode: u.mode,
    operationLimit,
    operationsLeft,
    frozen,
    stunned,
    sleeping,
  };
}
export function findUnit(s: GamePosition, id?: string): Unit {
  const u = allPieces(s).find((u) => u.id === id);
  ensure(u, '请选择仍在场上的随从。');
  return u;
}
export const asTarget = (u: Unit): Target => ({
  id: u.id,
  owner: u.owner,
  x: u.x,
  y: u.y,
  unit: u,
});
export function actor(s: GamePosition, id?: string) {
  const u = findUnit(s, id),
    stats = getStats(s, u);
  ensure(s.phase === 'play', '请先完成回合开始阶段。');
  ensure(allegiance(s, u) === s.active, '不是该随从的回合。');
  ensure(
    !stats.sleeping && !stats.frozen && !stats.stunned,
    '该随从正在疲劳、休整、冰冻或眩晕中。',
  );
  return u;
}
export function chooseMode(s: GamePosition, u: Unit, mode: Mode) {
  const stats = getStats(s, u);
  ensure(
    u.mode === 'none' || u.mode === mode,
    '本回合已选择另一操作模式，剩余攻击不能换成移动或技能。',
  );
  if (u.mode === 'none') {
    if (mode === 'attack' && stats.operationsLeft <= 0 && u.bonusAttacks > 0) {
      u.bonusAttacks--;
      u.bonusSequence = true;
    } else ensure(stats.operationsLeft > 0, '本回合操作已用完。');
    u.mode = mode;
    u.shots = 0;
    u.moves = 0;
  }
  if (mode === 'attack') ensure(getStats(s, u).remaining > 0, '本次攻击操作次数已用完。');
}
export function finishOperation(u: Unit) {
  if (!u.bonusSequence) u.operations++;
  u.bonusSequence = false;
  u.mode = 'none';
  u.shots = 0;
  u.moves = 0;
}
export function point(x?: number, y?: number): Point {
  ensure(Number.isInteger(x) && Number.isInteger(y), '请选择棋盘格。');
  return { x: x!, y: y! };
}
export function resetUnit(s: GamePosition, u: Unit) {
  u.operations = 0;
  u.mode = 'none';
  u.shots = 0;
  u.moves = 0;
  u.attacked = [];
  u.bonusAttacks = 0;
  u.bonusSequence = false;
  u.weaponFirstUsed = false;
  u.readyCharge = u.charge;
  if (u.extraOperations !== undefined) u.extraOperations = 0;
  for (const reserve of Object.values(u.abilityCharges ?? {}))
    if (reserve) reserve.readyCharge = reserve.charge;
  u.effects = u.effects.filter((e) => e.until > (e.global ? s.ply : now(s, u)));
}
export function addEffect(
  s: GamePosition,
  u: Unit,
  type: Effect['type'],
  owner: Player,
  delay: number,
  duration: number,
  amount?: number,
  sourceId?: string,
  global = false,
) {
  const base = global ? s.ply : now(s, u);
  u.effects.push({
    type,
    owner,
    from: base + delay,
    until: base + delay + duration,
    ...(amount === undefined ? {} : { amount }),
    ...(sourceId === undefined ? {} : { sourceId }),
    ...(global ? { global: true } : {}),
  });
}
export function storageRemaining(s: GamePosition, c: Card) {
  return c.expiresAt === undefined ? null : c.expiresAt - s.turns[s.active];
}
