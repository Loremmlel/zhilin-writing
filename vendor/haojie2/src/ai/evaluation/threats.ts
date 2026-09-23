import {
  refusesConversion,
  abilityKinds,
  allPieces,
  hasTrait,
  anyTrait,
  isLandmark,
  chargeFor,
  consumeCharge,
} from '../../engine/core/traits';
import { damageBonus } from '../../engine/setup/shrines';
import { firelordStrike } from '../../engine/commands/firelord';
import { combinedAttackPackets } from '../../engine/core/attack-profile';
import { COMBAT_RULES } from '../../engine/catalog';
import {
  attackPath,
  basePoint,
  cells,
  distance,
  other,
  targets,
  topTarget,
  canPlace,
  neighbors,
} from '../../engine/core/geometry';
import {
  piercing,
  activeEffect,
  asTarget,
  effectClock,
  has,
  passive,
} from '../../engine/core/state';
import { availableGuardians } from '../../engine/core/protection';
import type { AttackDirection, GameState, Player, Target, Unit } from '../../engine/types';
import { actionWindow, hitDistance, isFrontHit, statsFor } from './spatial';
/** 伤害与效用估计，不能替代搜索节点中的精确 distribution() 概率分布。 */
export function readyAttack(s: GameState, u: Unit): boolean {
  const st = statsFor(s, u);
  return (
    st.remaining > 0 &&
    !st.sleeping &&
    !st.frozen &&
    !st.stunned &&
    !(
      passive(s, u) &&
      ((hasTrait(u, 4) && chargeFor(u, 4).readyCharge < 2) || hasTrait(u, 'firelord'))
    )
  );
}
export function hitPackets(
  s: GameState,
  u: Unit,
  t: Target,
  direction?: AttackDirection,
): { damage: number; probability: number }[] {
  const st = statsFor(s, u);
  if (t.unit && has(s, t.unit, 'immune')) return [{ damage: 0, probability: 1 }];
  if (st.attack < 0 || (t.unit && isLandmark(t.unit) && !topTarget(s, t) && !piercing(u)))
    return [{ damage: 0, probability: 1 }];
  let packets = combinedAttackPackets(abilityKinds(u), st.attack, u.kills, !passive(s, u), !t.unit);
  if (passive(s, u)) {
    if (hasTrait(u, 10))
      packets = [
        {
          damage:
            st.attack > 0
              ? st.attack
              : (t.unit ? t.unit.hp === t.unit.maxHp : s.bases[t.owner] === 300)
                ? COMBAT_RULES.catapultMarkDamage
                : 0,
          probability: 1,
        },
      ];
  }
  return defendedPackets(s, u, t, packets, direction);
}
function defendedPackets(
  s: GameState,
  u: Unit,
  t: Target,
  packets: { damage: number; probability: number }[],
  direction?: AttackDirection,
) {
  if (t.unit && has(s, t.unit, 'immune')) return [{ damage: 0, probability: 1 }];
  const bonus = damageBonus(s, { owner: u.owner, unit: u, kind: 'attack' });
  if (bonus) packets = packets.map((p) => ({ ...p, damage: p.damage + bonus }));
  if (t.unit && passive(s, t.unit)) {
    if (hasTrait(t.unit, 'u18'))
      packets = packets.map((p) => ({
        ...p,
        damage: p.damage <= COMBAT_RULES.kingAttackImmunity ? 0 : p.damage,
      }));
    if (
      hasTrait(t.unit, 24) &&
      (direction
        ? direction === (t.owner === 1 ? 'up' : 'down')
        : isFrontHit(
            s,
            u,
            t,
            s.units.some((v) => v.id === t.id && (v.x !== t.x || v.y !== t.y)) ? t.id : '',
          ))
    )
      packets = packets.map((p) => ({
        ...p,
        damage: Math.min(COMBAT_RULES.frontDamageCap, p.damage),
      }));
  }
  if (t.unit && hasTrait(t.unit, '17p') && !t.unit.silenced)
    packets = packets.flatMap((p) =>
      p.damage > 0
        ? [
            { damage: 0, probability: p.probability * COMBAT_RULES.littleGoldImmunity },
            { ...p, probability: p.probability * (1 - COMBAT_RULES.littleGoldImmunity) },
          ]
        : [p],
    );
  return packets;
}
export function attackPressure(s: GameState, u: Unit, t: Target, ignoreId = ''): number {
  if (hasTrait(u, 'firelord')) {
    if (t.unit && has(s, t.unit, 'immune')) return 0;
    const view = t.unit ? { ...s, units: [...s.units.filter((v) => v.id !== t.id), t.unit] } : s;
    const strike = firelordStrike(view, u);
    return strike?.primary.some((v) => v.id === t.id)
      ? COMBAT_RULES.firelord.damage + damageBonus(view, { owner: u.owner, unit: u, kind: 'skill' })
      : strike?.splash.some((v) => v.id === t.id)
        ? COMBAT_RULES.firelord.splash +
          damageBonus(view, { owner: u.owner, unit: u, kind: 'skill' })
        : 0;
  }
  if (
    statsFor(s, u).attack < 0 ||
    !readyAttack(s, u) ||
    !Number.isFinite(hitDistance(s, u, t, ignoreId))
  )
    return 0;
  if (hasTrait(u, 9) && passive(s, u) && u.attacked.includes(t.id)) return 0;
  if (t.unit && has(s, t.unit, 'immune')) return 0;
  const packets = hitPackets(s, u, t);
  let amount = packets.reduce((v, p) => v + p.damage * p.probability, 0);
  const one = passive(s, u) && (hasTrait(u, 9) || hasTrait(u, 4) || hasTrait(u, 10));
  const count = one ? 1 : statsFor(s, u).remaining;
  if (hasTrait(u, 15) && !u.silenced && chargeFor(u, 15).charge > 0) {
    const empty = { ...u, abilityCharges: structuredClone(u.abilityCharges) };
    consumeCharge(empty, 15);
    const followUp = Number.isFinite(hitDistance(s, empty, t, ignoreId))
      ? hitPackets(s, empty, t).reduce((v, p) => v + p.damage * p.probability, 0)
      : 0;
    amount += Math.max(0, count - 1) * followUp;
  } else amount *= count;
  if (
    (u.equipment.includes('s15') || hasTrait(u, 's6')) &&
    (!t.unit || !isLandmark(t.unit) || topTarget(s, t) || piercing(u))
  ) {
    const extras = [
      u.equipment.includes('s15')
        ? Math.max(0, (t.unit?.maxHp ?? 300) - (t.unit?.hp ?? s.bases[t.owner]))
        : 0,
      !u.silenced && hasTrait(u, 's6')
        ? (u.receivedDamage ?? [])
            .filter((r) => r.ply >= s.ply - 1)
            .reduce((n, r) => n + r.amount, 0)
        : 0,
    ];
    for (const extra of extras)
      if (extra > 0) {
        const packets = defendedPackets(s, u, t, [{ damage: extra, probability: 1 }]);
        amount += count * packets.reduce((n, p) => n + p.damage * p.probability, 0);
      }
  }
  if (t.unit) {
    if (u.equipment.includes('s16') && !has(s, t.unit, 'immune'))
      amount += Math.min(15, Math.max(0, statsFor(s, t.unit).attack)) * 0.5;
    if (passive(s, u) && hasTrait(u, 'u4')) amount += 12;
    if (u.equipment.includes('u5')) amount += 15;
    if (passive(s, u) && hasTrait(u, 'u6') && !u.equipment.includes('u5')) amount += 15;
  }
  return amount;
}
export function incoming(s: GameState, target: Unit, nextFullTurn = false): number {
  const view = actionWindow(s, other(target.owner), nextFullTurn),
    t = asTarget(target);
  const original = s.units.find((u) => u.id === target.id);
  const ignore = original && (original.x !== target.x || original.y !== target.y) ? target.id : '';
  let total = 0;
  for (const v of allPieces(view))
    if (v.owner !== target.owner && v.id !== target.id) total += attackPressure(view, v, t, ignore);
  return total;
}
export function baseThreat(s: GameState, defender: Player): number {
  const view = actionWindow(s, other(defender));
  const target = { id: `base-${defender}`, owner: defender, ...basePoint(defender) };
  return allPieces(view)
    .filter((u) => u.owner !== defender)
    .reduce((v, u) => v + attackPressure(view, u, target), 0);
}
/** 标记必须在全局到期前，由另一名非投石机友方命中才能兑现。 */
export function markFollowUp(s: GameState, target: Target, owner: Player, until: number): number {
  const view = actionWindow(s, owner);
  if (view.ply >= until) return 0;
  let best = 0;
  for (const u of view.units) {
    if (
      u.owner !== owner ||
      hasTrait(u, 10) ||
      !readyAttack(view, u) ||
      (hasTrait(u, 9) && !u.silenced && u.attacked.includes(target.id)) ||
      !Number.isFinite(hitDistance(view, u, target))
    )
      continue;
    const hp = target.unit?.hp ?? view.bases[target.owner];
    const guarded = target.unit && availableGuardians(view, target.unit).length > 0;
    const packets = hitPackets(view, u, target);
    let probability = packets.reduce(
      (n, p) => n + (p.damage < hp || guarded ? p.probability : 0),
      0,
    );
    if (!probability) continue; // 已经致死的后续攻击不能再兑现额外五点伤害。
    const hit = packets.reduce((n, p) => n + p.probability * p.damage, 0);
    // 后续命中合法不代表一定执行；濒死射手可能合理撤退。
    if (
      target.unit &&
      hit + 5 < target.unit.hp &&
      incoming(view, u) >= u.hp &&
      statsFor(view, u).move >= 1 &&
      neighbors(u).some((p) => canPlace(view, u, p) && incoming(view, { ...u, ...p }) < u.hp)
    )
      probability *= 0.25;
    best = Math.max(best, probability);
  }
  return best;
}
export interface PayloadAnalysis {
  carrierId: string;
  type: 'execute' | 'convert';
  value: number;
  window: number;
  survival: number;
  targets: { id: string; probability: number; value: number; reason: string }[];
}
/** 向可选 CLI 跟踪公开同一机会计算，不读取未来随机结果。 */
export function analyzePayload(
  s: GameState,
  u: Unit,
  type: 'execute' | 'convert',
  valueOf: (u: Unit) => number,
): PayloadAnalysis {
  const result: PayloadAnalysis = {
    carrierId: u.id,
    type,
    value: 0,
    window: s.ply,
    survival: 0,
    targets: [],
  };
  const effect = u.effects.find((e) => e.type === type);
  if (!effect || (type === 'convert' && refusesConversion(u))) return result;
  const view = actionWindow(s, u.owner, effect.from > effectClock(s, effect, u));
  result.window = view.ply;
  const carrier = view.units.find((v) => v.id === u.id);
  if (!carrier || !activeEffect(view, effect, carrier) || !readyAttack(view, carrier))
    return result;
  for (const victim of view.units) {
    if (victim.owner === u.owner || !topTarget(view, asTarget(victim))) continue;
    let reason = '可兑现';
    if (has(view, victim, 'immune')) reason = '金身保护';
    else if (!Number.isFinite(hitDistance(view, carrier, asTarget(victim))))
      reason = '无合法攻击路径';
    else if (
      view.units.some(
        (v) =>
          hasTrait(v, 'u15') &&
          v.owner === victim.owner &&
          passive(view, v) &&
          attackPath(view, v, asTarget(victim), statsFor(view, v).range),
      )
    )
      reason = '免疫塔保护';
    const probability =
      reason !== '可兑现'
        ? 0
        : type === 'execute'
          ? 1
          : hitPackets(view, carrier, asTarget(victim)).reduce(
              (n, p) =>
                n +
                (p.damage > 0 &&
                (p.damage < victim.hp ||
                  (victim.hp > 1 && availableGuardians(view, victim).length > 0))
                  ? p.probability
                  : 0),
              0,
            );
    if (!probability && reason === '可兑现') reason = '没有造成正伤害后存活的分支';
    result.targets.push({
      id: victim.id,
      probability,
      value: valueOf(victim) * probability * (type === 'convert' ? 1.3 : 0.85),
      reason,
    });
  }
  result.survival = Math.max(0.12, 1 - 0.75 * Math.min(1, incoming(s, u) / Math.max(1, u.hp)));
  result.value =
    Math.max(0, ...result.targets.map((t) => t.value)) *
    (effect.from > effectClock(s, effect, u) ? 0.55 : 0.8) *
    result.survival;
  result.targets.sort((a, b) => b.value - a.value);
  return result;
}
export function payloadOpportunity(
  s: GameState,
  u: Unit,
  type: 'execute' | 'convert',
  valueOf: (u: Unit) => number,
): number {
  return analyzePayload(s, u, type, valueOf).value;
}

const coverCache = new WeakMap<
  GameState,
  Map<Player, { view: GameState; target: Target; pressure: number; route: Set<string> }>
>();
/** 保留牺牲式基地掩护候选。占格不仅为存活，阻断致命攻击可能值得让防守者下回合阵亡。先与真实攻击路径相交，再用新占位重算合法可达性。 */
export function baseCoverValue(s: GameState, defender: Unit): number {
  let sides = coverCache.get(s);
  if (!sides) {
    sides = new Map();
    coverCache.set(s, sides);
  }
  let data = sides.get(defender.owner);
  if (!data) {
    const view = actionWindow(s, other(defender.owner));
    const target: Target = {
      id: `base-${defender.owner}`,
      owner: defender.owner,
      ...basePoint(defender.owner),
    };
    const route = new Set<string>();
    let pressure = 0;
    for (const attacker of view.units.filter((v) => v.owner !== defender.owner)) {
      const amount = attackPressure(view, attacker, target);
      if (!amount) continue;
      pressure += amount;
      // 炎魔之心可穿透新掩护，能制造压力，但不能提供阻断机会。
      if (attacker.equipment.includes('u28')) continue;
      for (const p of attackPath(view, attacker, target, statsFor(view, attacker).range) ?? [])
        route.add(`${p.x},${p.y}`);
    }
    data = { view, target, pressure, route };
    sides.set(defender.owner, data);
  }
  if (!data.pressure || !cells(defender).some((p) => data!.route.has(`${p.x},${p.y}`))) return 0;
  const view = {
    ...data.view,
    units: [...data.view.units.filter((v) => v.id !== defender.id), defender],
  };
  let after = 0;
  for (const attacker of view.units)
    if (attacker.owner !== defender.owner) after += attackPressure(view, attacker, data.target);
  const hp = s.bases[defender.owner];
  const reduction = Math.max(0, Math.min(hp, data.pressure) - Math.min(hp, after));
  return reduction * 3.1 + (data.pressure >= hp && after < hp ? 180 : 0);
}

const payloadCoverCache = new WeakMap<
  GameState,
  Map<
    Player,
    { route: Set<string>; carriers: { id: string; type: 'execute' | 'convert'; value: number }[] }
  >
>();
/** 保留保护高价值单位的拦截候选，不仅保护基地。 */
export function payloadCoverValue(
  s: GameState,
  defender: Unit,
  valueOf: (u: Unit) => number,
): number {
  let sides = payloadCoverCache.get(s);
  if (!sides) {
    sides = new Map();
    payloadCoverCache.set(s, sides);
  }
  let data = sides.get(defender.owner);
  if (!data) {
    data = { route: new Set(), carriers: [] };
    for (const u of s.units) {
      if (u.owner === defender.owner || u.equipment.includes('u28')) continue;
      for (const type of ['execute', 'convert'] as const) {
        if (!u.effects.some((e) => e.type === type)) continue;
        const analysis = analyzePayload(s, u, type, valueOf);
        const victim = s.units.find((v) => v.id === analysis.targets[0]?.id);
        if (!analysis.value || !victim) continue;
        const view = actionWindow(s, u.owner),
          carrier = view.units.find((v) => v.id === u.id);
        if (!carrier) continue;
        for (const p of attackPath(
          view,
          carrier,
          asTarget(victim),
          statsFor(view, carrier).range,
        ) ?? [])
          data.route.add(`${p.x},${p.y}`);
        data.carriers.push({ id: u.id, type, value: analysis.value });
      }
    }
    sides.set(defender.owner, data);
  }
  if (!cells(defender).some((p) => data!.route.has(`${p.x},${p.y}`))) return 0;
  const view = { ...s, units: [...s.units.filter((v) => v.id !== defender.id), defender] };
  return data.carriers.reduce((n, c) => {
    const carrier = view.units.find((u) => u.id === c.id)!;
    return n + Math.max(0, c.value - analyzePayload(view, carrier, c.type, valueOf).value);
  }, 0);
}
