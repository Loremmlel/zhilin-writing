import { landmarkAt, liveLandmark } from '../../engine/setup/shrines';
import { auraValue, shrinePrior } from '../planning/shrines';
import {
  hasTrait,
  isLandmark,
  chargeFor,
  abilityKinds,
  allPieces,
  canDeployKind,
} from '../../engine/core/traits';
import { COMBAT_RULES } from '../../engine/catalog';
import { definition, isStored } from '../../engine/catalog';
import {
  basePoint,
  canPlace,
  cells,
  distance,
  neighbors,
  other,
  targets,
  movementPath,
} from '../../engine/core/geometry';
import { allegiance, asTarget, getStats, has, passive, template } from '../../engine/core/state';
import type { Card, GameState, Player, Point, Unit } from '../../engine/types';
import { actionWindow, hitDistance, occupantsAt, statsFor } from './spatial';
import { baseThreat, incoming, markFollowUp, payloadOpportunity, readyAttack } from './threats';
export { baseThreat } from './threats';
/** 可调的策略估值，不是规则属性或概率；必须留在 AI 层。 */
const passives: Partial<Record<Unit['kind'], number>> = {
  2: 16,
  3: 40,
  4: 10,
  6: 12,
  7: 18,
  10: 12,
  11: 15,
  12: 12,
  14: 6,
  16: 8,
  19: 12,
  20: 12,
  21: 12,
  23: 4,
  24: 14,
  26: 14,
  u3: 26,
  u4: 30,
  u6: 32,
  u8: 28,
  u13: 18,
  u14: 38,
  u15: 30,
  u18: 28,
  u19: 20,
  u20: 25,
  u21: 24,
  u22: 20,
  u23: 18,
  u24: 17,
  firelord: 65,
  sage: 55,
  formless: 38,
  slayer: 60,
  citadel: 55,
  archmage: 55,
};
/** 棋子的战略资产价值，与当前能否行动及战术可达性分别计算。 */
export function materialValue(s: GameState, u: Unit): number {
  const st = statsFor(s, u),
    ratio = Math.min(1, u.hp / u.maxHp);
  // 已储存的爆发伤害是一次性资源，不能当作永久输出重复计价；
  // 否则定炮和蓄力怪会更倾向保留蓄力而非实际攻击。
  const attack =
    passive(s, u) && u.kind === 'u2'
      ? Math.max(0, st.attack - u.charge * 15)
      : passive(s, u) && u.kind === 15
        ? Math.max(0, st.attack - u.charge * COMBAT_RULES.accumulator.attack)
        : passive(s, u) && u.kind === 4
          ? st.attack / 3
          : definition(u.kind).actions === 0.5
            ? st.attack / 2
            : Math.max(0, st.attack);
  let value =
    14 +
    u.hp * 0.38 +
    u.maxHp * 0.12 +
    attack * Math.sqrt(st.actions) * (0.65 + 0.3 * ratio) +
    Math.min(
      8,
      st.range - (passive(s, u) && u.kind === 15 ? u.charge * COMBAT_RULES.accumulator.range : 0),
    ) *
      2;
  if (passive(s, u))
    value +=
      abilityKinds(u).reduce<number>((n, k) => n + (passives[k] ?? 0), 0) +
      (definition(u.kind).tier === 'shrine' ? shrinePrior(u.kind) * 0.35 : 0);
  if (passive(s, u) && u.kind === 'sage')
    value += Math.min(
      60,
      s.units
        .filter((v) => v.id !== u.id && allegiance(s, v) === u.owner)
        .reduce((n, v) => n + (v.maxHp - v.hp) * 0.18, 0),
    );
  if (u.kind === 'grave' || u.kind === 'wall') value = 4 + u.hp * 0.16;
  if (u.kind === 'u25') value -= 7;
  if (u.kind === 'u12' || u.kind === 'u12p') value += 30;
  if (u.expiresAt !== undefined) value *= 0.35;
  if (st.frozen) value *= 0.5;
  else if (st.sleeping || st.stunned) value *= 0.88;
  // 蓄力能力必须能及时作用于目标，才具有可兑现的价值。
  const enemyBase = basePoint(other(u.owner));
  const nearest = Math.min(
    distance(u, enemyBase),
    ...s.units.filter((v) => v.owner !== u.owner).map((v) => distance(u, v)),
  );
  const contact = Math.max(0, nearest - Math.min(6, st.range));
  const discount = 1 / (1 + contact * 0.16);
  value +=
    (u.kind === 4
      ? Math.min(2, u.charge) * 12 + Math.max(0, u.charge - 2) * 2
      : u.charge *
        (u.kind === 'u2' ? 6.75 : u.kind === 'u6' ? 16 : u.chargeType === 'move' ? 7 : 6)) *
    discount;
  value += u.equipment.includes('u5')
    ? 20
    : u.equipment.includes('u16')
      ? 16
      : u.equipment.includes('u28')
        ? 22
        : 0;
  for (const e of u.effects) {
    if (e.type === 'immune')
      value += Math.min(
        24,
        incoming(s, { ...u, effects: u.effects.filter((v) => v !== e) }) * 0.35,
      );
    if (e.type === 'attack') value += Math.min(15, e.amount ?? 0) * 0.65 * discount;
    if (e.type === 'burn') value -= Math.min(u.hp, 12) * 0.5;
  }
  return Math.max(1, value);
}
export function unitValue(s: GameState, u: Unit): number {
  let value = materialValue(s, u);
  value += payloadOpportunity(s, u, 'execute', (v) => materialValue(s, v));
  value += payloadOpportunity(s, u, 'convert', (v) => materialValue(s, v));
  for (const e of u.effects)
    if (e.type === 'mark') value -= 5 * 0.9 * markFollowUp(s, asTarget(u), e.owner, e.until);
  return value;
}
export function cardValue(s: GameState, c: Card, owner: Player): number {
  const d = definition(c.kind);
  if (d.aura) return (auraValue[c.kind] ?? 50) * 0.75;
  if (d.tier === 'shrine' && d.weapon !== undefined) return shrinePrior(c.kind) * 0.6;
  if (canDeployKind(c.kind)) {
    const raw = template(c.kind, owner, 0, { x: 5, y: owner === 1 ? 6 : 8 });
    return materialValue(s, raw) * 0.76;
  }
  const remaining = (c.expiresAt ?? s.turns[owner] + 20) - s.turns[owner];
  const values: Partial<Record<Unit['kind'], number>> = {
    8: 22,
    17: 14,
    18: 27,
    22: 34,
    25: 38,
    u5: 32,
    u9: 42,
    u11: 30,
    u16: 30,
    u17: 30,
    u26: 34,
    u28: 34,
  };
  return (values[c.kind] ?? 20) * Math.min(1, 0.4 + Math.max(0, remaining - 1) * 0.17);
}
/** 人头购买的是未来抽牌的升级机会，不是额外一整个单位。囤积价值应饱和，不能为保留16人头而放弃八次有用升级。 */
export function headValue(heads: number): number {
  return (
    Math.min(2, heads) * 3 +
    Math.min(2, Math.max(0, heads - 2)) * 2 +
    Math.min(4, Math.max(0, heads - 4))
  );
}
/** 估算最早有效接敌、掩护和回应窗口中的暴露风险；未蓄力定炮不能直接计为100点威胁。 */
export function placementValue(s: GameState, u: Unit, p: Point, nextFullTurn = false): number {
  const moved = u.x === p.x && u.y === p.y ? u : { ...u, x: p.x, y: p.y },
    st = statsFor(s, moved),
    enemyBase = basePoint(other(u.owner));
  const enemies = allPieces(s).filter((v) => v.id !== u.id && allegiance(s, v) !== u.owner);
  const separation = (v: Unit) =>
    Math.min(...cells(v).flatMap((q) => cells(moved).map((a) => distance(a, q))));
  const nearest = Math.min(
    ...cells(moved).map((q) => distance(q, enemyBase)),
    ...enemies.map(separation),
  );
  const support = [
    2,
    3,
    6,
    'u3',
    'u13',
    'u14',
    'u15',
    'u19',
    'u21',
    'u22',
    'sage',
    'citadel',
    'archmage',
    's4',
    's14',
  ].some((k) => hasTrait(u, k as Unit['kind']));
  const range = st.range,
    speed = Math.max(0.5, Math.min(3, st.move));
  const turnsToContact = Math.max(0, nearest - range) / speed;
  let score =
    20 / (1 + turnsToContact * 0.4) + 8 / (1 + Math.max(0, distance(p, enemyBase) - range) * 0.15);
  if (st.attack > 0 || ['u6', 'u12', 'u12p', 'firelord'].includes(String(u.kind)))
    score += Math.max(0, Math.min(3, range - nearest + 1)) * 2;
  if (support) {
    const friends = s.units.filter(
      (v) => v.id !== u.id && allegiance(s, v) === u.owner && distance(v, p) <= range,
    );
    score += Math.min(
      16,
      friends.reduce((n, v) => n + 2 + Math.min(5, (v.maxHp - v.hp) * 0.12), 0),
    );
    score -= Math.max(0, 2 - nearest) * 3;
  }
  const danger = incoming(s, moved, nextFullTurn);
  // 惩罚下一实际行动窗口的损失和死亡风险，不循环累加“射程内有敌人”的数量。
  const exposureSlope = nextFullTurn
    ? u.kind === 'grave' || u.kind === 'wall'
      ? 0.06
      : 0.15
    : 0.42;
  score -= Math.min(moved.hp, danger) * exposureSlope;
  if (danger >= moved.hp)
    score -= nextFullTurn
      ? Math.min(materialValue(s, moved) * 0.45, 55)
      : Math.min(45, 14 + st.attack * 0.35);
  const stacked = occupantsAt(s, p).filter((v) => v.id !== u.id && v.owner === u.owner).length;
  if (!nextFullTurn && u.kind === 'u25' && stacked) score -= Math.pow(stacked, 1.35) * 2;
  const land = landmarkAt(s, p);
  if (!isLandmark(u) && liveLandmark(land) && land.owner === u.owner)
    score += hasTrait(land, 's1') ? 12 : 5;
  if (isLandmark(u))
    score += hasTrait(u, 's8')
      ? 28
      : s.units.filter((v) => v.owner === u.owner && distance(v, p) <= 4).length * 4;
  return score;
}
function formation(s: GameState, side: Player): number {
  const view = actionWindow(s, side, true),
    home = basePoint(side),
    foe = basePoint(other(side));
  const lanes = new Set<number>(),
    stacks = new Map<string, number>();
  let value = 0;
  const enemy = targets(view).filter((t) => t.owner !== side);
  for (const u of view.units.filter((v) => v.owner === side)) {
    const st = statsFor(view, u);
    const contacts = readyAttack(view, u)
      ? enemy.filter((t) => Number.isFinite(hitDistance(view, u, t)))
      : [];
    if (contacts.length) {
      lanes.add(u.x);
      value += Math.min(3, contacts.length) * 1.6;
    }
    if (u.kind === 'u25') {
      const k = `${u.x},${u.y}`;
      stacks.set(k, (stacks.get(k) ?? 0) + 1);
    }
    if (st.move <= 0 || st.frozen || u.kind === 'grave' || u.kind === 'wall') continue;
    const points =
      u.kind === 13 && !u.silenced
        ? [
            { x: u.x + 3, y: u.y },
            { x: u.x - 3, y: u.y },
            { x: u.x, y: u.y + 3 },
            { x: u.x, y: u.y - 3 },
          ].filter((p) => !!movementPath(view, u, p, 3, true))
        : neighbors(u).filter((p) => canPlace(view, u, p));
    if (!points.length && !contacts.length) value -= 12;
    else if (!contacts.length) {
      const forward = points.filter((p) => distance(p, foe) < distance(u, foe)).length;
      value += Math.min(2, forward) * 1.5;
      if (!forward && distance(u, foe) > st.range + 1) value -= 4;
    }
    // 围着自家基地休眠的军队不构成领土控制。
    if (distance(u, home) < 3 && !contacts.length && st.attack > 0) value -= 4;
  }
  for (const n of stacks.values()) value -= Math.pow(Math.max(0, n - 1), 1.6) * 3;
  return value + Math.min(5, lanes.size) * 3;
}
export interface EvaluationBreakdown {
  bases: number;
  resources: number;
  force: number;
  position: number;
  formation: number;
  effects: number;
  total: number;
}
export function explainEvaluation(s: GameState, side: Player): EvaluationBreakdown {
  const result: EvaluationBreakdown = {
    bases: 0,
    resources: 0,
    force: 0,
    position: 0,
    formation: 0,
    effects: 0,
    total: 0,
  };
  if (s.winner) {
    result.bases = s.winner === 'draw' ? 0 : s.winner === side ? 100000 : -100000;
    result.total = result.bases;
    return result;
  }
  for (const p of [1, 2] as Player[]) {
    const sign = p === side ? 1 : -1,
      hp = s.bases[p],
      danger = baseThreat(s, p);
    result.bases +=
      sign *
      (hp * 3.1 -
        danger * 0.65 -
        (danger >= hp ? 900 + (danger - hp) * 4 : danger > hp * 0.6 ? 120 : 0));
    result.resources +=
      sign *
      (headValue(s.heads[p]) +
        s.bonus[p] * 28 +
        (s.phase === 'play' && s.active === p ? Math.max(0, s.summonSlots) * 28 : 0) +
        s.hands[p].reduce((n, c) => n + cardValue(s, c, p), 0));
    result.position += sign * s.deployRows[p].filter((y) => (p === 1 ? y > 8 : y < 6)).length * 8;
    result.formation += sign * formation(s, p);
    for (const e of s.baseEffects[p])
      if (e.type === 'mark')
        result.effects -=
          sign *
          5 *
          0.9 *
          markFollowUp(s, { id: `base-${p}`, owner: p, ...basePoint(p) }, e.owner, e.until);
  }
  for (const p of [1, 2] as Player[]) {
    result.effects +=
      (p === side ? 1 : -1) *
      (s.auras?.[p] ?? []).reduce((n, a) => n + (auraValue[a.kind] ?? 0), 0);
    result.effects +=
      (p === side ? 1 : -1) *
      (s.landmarks ?? [])
        .filter((l) => l.owner === p && l.dormantSince !== undefined)
        .reduce((n, l) => n + shrinePrior(l.kind) * 0.12, 0);
  }
  const assets: Record<Player, number> = { 1: 0, 2: 0 };
  for (const u of allPieces(s)) assets[u.owner] += materialValue(s, u);
  for (const u of allPieces(s)) {
    const sign = u.owner === side ? 1 : -1;
    result.force += sign * unitValue(s, u);
    result.position += sign * placementValue(s, u, u, true);
    // 将明确的场面优势转化为对基地的接触压力，避免无休止地在附近换子。
    // 这是有界、对称的策略效用，并不保证每次推进都安全。
    const st = statsFor(s, u);
    const advantage = Math.max(
      0,
      (assets[u.owner] - assets[other(u.owner)]) /
        Math.max(100, assets[u.owner] + assets[other(u.owner)]),
    );
    if (st.move > 0 && st.attack > 0 && !st.frozen && s.bases[u.owner] > baseThreat(s, u.owner))
      result.position +=
        (sign * advantage * 24) /
        (1 + Math.max(0, distance(u, basePoint(other(u.owner))) - st.range) * 0.25);
    for (const h of s.hazards)
      if (cells(u).some((p) => (h.axis === 'row' ? p.y === h.line : p.x === h.line)))
        result.effects -= sign * Math.min(u.hp, 20) * 0.5;
    for (const m of s.iceMarks)
      if (m.owner !== u.owner && cells(u).some((p) => p.x === m.x && p.y === m.y))
        result.effects -= sign * 18;
  }
  for (const l of s.siphons) {
    const from = s.units.find((u) => u.id === l.fromId),
      to = s.units.find((u) => u.id === l.toId);
    const fromOwner = from?.owner ?? (l.fromId.startsWith('base-') ? Number(l.fromId.slice(5)) : 0);
    const toOwner = to?.owner ?? (l.toId.startsWith('base-') ? Number(l.toId.slice(5)) : 0);
    if (fromOwner)
      result.effects += (fromOwner === side ? -1 : 1) * Math.min(20, from?.hp ?? 300) * 0.9;
    if (toOwner)
      result.effects +=
        (toOwner === side ? 1 : -1) *
        Math.min(20, to ? to.maxHp - to.hp : 300 - s.bases[toOwner as Player]);
  }
  result.total =
    result.bases +
    result.resources +
    result.force +
    result.position +
    result.formation +
    result.effects;
  return result;
}
export function evaluate(s: GameState, side: Player): number {
  return explainEvaluation(s, side).total;
}
