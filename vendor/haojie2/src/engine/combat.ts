import { chargeFor, consumeCharge, attackChargeKind } from './traits';
import {
  abilityKinds,
  allPieces,
  anyTrait,
  canAttackFriend,
  hasTrait,
  isLandmark,
  isShrine,
  signedAttack,
} from './traits';
import {
  damageBonus,
  demolish,
  healingBlocked,
  landmarkAt,
  liveLandmark,
  returnDeathWeapons,
  stealOnKill,
  syncBanners,
} from './shrines';
import { eventActor, withEventFacts } from './event-facts';
import { availableGuardians, spentGuardSources } from './protection';
import { definition, COMBAT_RULES } from './catalog';
import { attackProfile, vampireRate } from './attack-profile';
import {
  attackPath,
  piercingTargets,
  validAttackRoute,
  distance,
  inside,
  basePoint,
  canPlace,
  cells,
  equal,
  frontal,
  inSquare,
  occupants,
  other,
  ring,
  targets,
  topTarget,
} from './geometry';
import {
  activeEffect,
  addEffect,
  addUnit,
  allegiance,
  asTarget,
  emit,
  ensure,
  faction,
  findUnit,
  getStats,
  has,
  hasWeapon,
  healingAttack,
  piercing,
  now,
  passive,
  random,
  resetUnit,
} from './state';
import type { Effect, GamePosition, Player, Point, Source, Target, Unit } from './types';
export interface Resolution {
  retaliations: Set<string>;
  protection: Map<string, boolean>;
  token: number;
}
export const resolution = (): Resolution => ({
  retaliations: new Set(),
  protection: new Map(),
  token: 0,
});
export const alive = (s: GamePosition, u: Unit) =>
  s.units.some((v) => v.id === u.id) ||
  !!s.landmarks?.some((v) => v.id === u.id && v.dormantSince === undefined);
export function findTarget(s: GamePosition, id?: string): Target {
  const t = targets(s).find((t) => t.id === id);
  ensure(t, '请选择有效的目标。');
  return t;
}
export const hostile = (s: GamePosition, u: Unit, t: Target) =>
  t.unit ? allegiance(s, t.unit) !== u.owner : t.owner !== u.owner;
const targetEffects = (s: GamePosition, t: Target) =>
  t.unit ? t.unit.effects : s.baseEffects[t.owner];
function removeEffect(s: GamePosition, t: Target, e: Effect) {
  if (t.unit) t.unit.effects = t.unit.effects.filter((v) => v !== e);
  else s.baseEffects[t.owner] = s.baseEffects[t.owner].filter((v) => v !== e);
}
/** One shield decision per target/effect packet; pure UI previews execute on a cloned state. */
export function protectedEffect(
  s: GamePosition,
  t: Target,
  source: Source,
  ctx: Resolution,
): boolean {
  if (!t.unit || source.owner === undefined || source.owner === t.owner) return false;
  if (has(s, t.unit, 'immune')) {
    emit(s, {
      type: 'shield',
      to: t,
      owner: t.owner,
      action: 'ward',
      stage: 'blocked',
      text: '金身免疫',
    });
    return true;
  }
  if (!['spell', 'skill'].includes(source.kind)) return false;
  const key = `${ctx.token}:${source.owner}:${t.id}`;
  if (ctx.protection.has(key)) return ctx.protection.get(key)!;
  const tower = s.units.find(
    (u) =>
      hasTrait(u, 'u15') &&
      u.owner === t.owner &&
      passive(s, u) &&
      attackPath(s, u, t, getStats(s, u).range),
  );
  ctx.protection.set(key, !!tower);
  if (tower) {
    emit(s, {
      type: 'shield',
      to: t,
      from: tower,
      owner: t.owner,
      action: 'ward',
      stage: 'blocked',
      text: '免疫塔',
    });
    lowerMax(s, tower, 15, ctx);
    return true;
  }
  return false;
}
export function lowerMax(s: GamePosition, u: Unit, amount: number, ctx: Resolution) {
  if (!alive(s, u)) return;
  u.maxHp = Math.max(0, u.maxHp - amount);
  u.hp = Math.min(u.hp, u.maxHp);
  if (u.hp <= 0) kill(s, u, { owner: u.owner, kind: 'sacrifice' }, ctx);
}
export function heal(s: GamePosition, t: Unit | Target, amount: number, ctx = resolution()) {
  const target = 'kind' in t ? asTarget(t) : t,
    u = target.unit;
  if (u && !alive(s, u)) return;
  if (healingBlocked(s, target.owner)) return;
  const gain = Math.max(0, Math.min(amount, u ? u.maxHp - u.hp : 300 - s.bases[target.owner]));
  if (u) u.hp = Math.round((u.hp + gain) * 1e6) / 1e6;
  else s.bases[target.owner] += gain;
  if (gain)
    emit(
      s,
      { type: 'heal', to: target, amount: gain, owner: target.owner },
      `${u ? definition(u.kind).name : '基地'}回复${gain}生命`,
    );
  if (u ? u.hp >= u.maxHp : s.bases[target.owner] >= 300)
    for (const e of [...targetEffects(s, target)])
      if (e.type === 'mark' && activeEffect(s, e, u)) {
        removeEffect(s, target, e);
        damage(
          s,
          target,
          COMBAT_RULES.catapultMarkDamage,
          { owner: e.owner, kind: 'status', unit: s.units.find((v) => v.id === e.sourceId) },
          ctx,
        );
      }
}
export function kill(
  s: GamePosition,
  u: Unit,
  source: Source = { kind: 'expire' },
  ctx = resolution(),
) {
  if (!alive(s, u)) return;
  if (isLandmark(u)) {
    demolish(s, u);
    return;
  }
  const snap = structuredClone(u);
  const inheritor = source.unit && s.units.find((v) => v.id === source.unit!.id);
  if (
    inheritor &&
    inheritor.id !== u.id &&
    source.owner !== undefined &&
    source.kind !== 'expire'
  ) {
    if (source.owner !== u.owner && inheritor.equipment.includes('s15'))
      inheritor.bladeQualified = true;
    stealOnKill(s, inheritor, u);
  }
  returnDeathWeapons(s, u);
  u.hp = 0;
  s.units = s.units.filter((v) => v.id !== u.id);
  s.deaths.push({
    id: `dead${s.serial++}`,
    kind: u.kind,
    owner: u.owner,
    ply: s.ply,
    revived: false,
    ...(u.group ? { group: u.group } : {}),
  });
  s.deaths = s.deaths.slice(-240);
  emit(
    s,
    { type: 'death', to: u, unitId: u.id, owner: u.owner },
    `${faction(u.owner)}的${definition(u.kind).name}离场`,
  );
  s.siphons = s.siphons.filter((l) => l.sourceId !== u.id && l.fromId !== u.id && l.toId !== u.id);
  s.iceMarks = s.iceMarks.filter((m) => m.sourceId !== u.id);
  const groupFinal =
    !u.group ||
    (!s.units.some((v) => v.group === u.group) &&
      ![...s.hands[1], ...s.hands[2]].some((c) => c.group === u.group));
  for (const city of s.units)
    if (
      hasTrait(city, 'citadel') &&
      city.owner === u.owner &&
      allegiance(s, snap) === u.owner &&
      passive(s, city) &&
      attackPath(s, city, asTarget(snap), getStats(s, city).range)
    )
      s.pending.push({
        kind: 'hut-spawn',
        owner: city.owner,
        source: structuredClone(city),
        amount: 0,
      });
  syncBanners(s);
  if (!groupFinal) return;
  const enabled = !u.silenced;
  const denyHead = enabled && hasTrait(u, 20) && random(s, [0, 0.5, 1]) < 0.5;
  const enemyKill =
    source.owner !== undefined &&
    source.owner !== u.owner &&
    source.kind !== 'expire' &&
    !source.ignoreHead;
  if (
    (enemyKill || (source.creditFriendly && source.owner === u.owner && !source.ignoreHead)) &&
    !denyHead
  ) {
    s.heads[source.owner!]++;
    emit(
      s,
      { type: 'skill', owner: source.owner, text: '+1 人头' },
      `${faction(source.owner!)}获得1人头`,
    );
  }
  if (denyHead)
    emit(
      s,
      { type: 'skill', to: u, owner: u.owner, text: '人头遁逃' },
      '超级跑得快：本次死亡不提供人头',
    );
  const killer = source.unit && s.units.find((v) => v.id === source.unit!.id);
  if (enemyKill && killer && !killer.silenced) {
    killer.kills++;
    if (hasTrait(killer, 26)) {
      const step = (killer.kills - 1) % 3;
      if (step === 0) {
        killer.maxHp += 10;
        heal(s, killer, 10, ctx);
      }
      if (step === 1) killer.attackBonus += 5;
      if (step === 2) killer.rangeBonus++;
    }
    if (hasTrait(killer, 'u8') && killer.kills === 5) killer.rangeBonus++;
    if (hasTrait(killer, 'u23')) {
      killer.hookReadyAt = now(s, killer) + 2;
      killer.hookExpiresAt = now(s, killer) + 4;
    }
  }
  if (enabled) {
    if (hasTrait(u, 11)) s.bonus[u.owner]++;
    if (hasTrait(u, 12)) {
      const grave = addUnit(s, 'grave', u.owner, u);
      grave.size = 1;
    }
    if (hasTrait(u, 2))
      s.pending.push({ kind: 'death-shot', owner: u.owner, source: snap, amount: 20 });
    if (hasTrait(u, 'sage') && passive(s, snap))
      for (const friend of [...s.units])
        if (allegiance(s, friend) === u.owner) heal(s, friend, friend.maxHp - friend.hp, ctx);
    if (hasTrait(u, 'u21'))
      for (const friend of [...s.units])
        if (
          friend.owner === u.owner &&
          attackPath(s, snap, asTarget(friend), getStats(s, snap).range)
        )
          heal(s, friend, 25, ctx);
    if (
      hasTrait(u, 20) &&
      !denyHead &&
      source.unit &&
      source.unit.id !== u.id &&
      !['sacrifice', 'expire'].includes(source.kind)
    ) {
      const target = s.units.find((v) => v.id === source.unit!.id);
      if (target)
        damage(
          s,
          asTarget(target),
          30,
          { owner: u.owner, unit: snap, kind: 'reflect', retaliated: true },
          ctx,
        );
    }
  }
  for (const hut of [...s.units])
    if (
      hasTrait(hut, 'u22') &&
      hut.owner === u.owner &&
      passive(s, hut) &&
      attackPath(s, hut, asTarget(snap), getStats(s, hut).range)
    ) {
      if (
        !s.pending.some(
          (r) =>
            r.kind === 'hut-spawn' && r.source.id === hut.id && r.source.lastCharge === s.serial,
        )
      ) {
        s.pending.push({
          kind: 'hut-spawn',
          owner: hut.owner,
          source: structuredClone(hut),
          amount: 0,
        });
      }
    }
}
/** Damage returns actual HP removed. Source ownership is retained for spell/DOT head credit. */
export function damage(
  s: GamePosition,
  t: Target,
  amount: number,
  source: Source,
  ctx = resolution(),
): number {
  amount = Math.max(0, amount + (source.modified ? 0 : damageBonus(s, source)));
  if (amount <= 0) return 0;
  if (!t.unit) {
    const loss = Math.min(s.bases[t.owner], amount);
    s.bases[t.owner] -= loss;
    if (loss)
      emit(
        s,
        { type: 'damage', to: t, unitId: t.id, owner: t.owner, amount: loss },
        `${faction(t.owner)}基地受到${loss}伤害`,
      );
    return loss;
  }
  const u = t.unit;
  if (!alive(s, u)) return 0;
  if (
    isLandmark(u) &&
    source.owner !== u.owner &&
    ['attack', 'collision'].includes(source.kind) &&
    !(source.unit && piercing(source.unit))
  ) {
    const cover = occupants(s, u).find((v) => allegiance(s, v) === u.owner);
    if (cover) return damage(s, asTarget(cover), amount, { ...source, modified: true }, ctx);
  }
  if (has(s, u, 'immune')) {
    emit(s, {
      type: 'shield',
      to: u,
      owner: u.owner,
      action: 'ward',
      stage: 'blocked',
      text: '金身',
    });
    return 0;
  }
  if (protectedEffect(s, t, source, ctx)) return 0;
  if (
    hasTrait(u, '17p') &&
    !u.silenced &&
    random(s, [0, COMBAT_RULES.littleGoldImmunity, 1]) < COMBAT_RULES.littleGoldImmunity
  ) {
    emit(s, {
      type: 'shield',
      to: u,
      owner: u.owner,
      action: 'ward',
      stage: 'blocked',
      text: '小金耶 · 免疫',
    });
    return 0;
  }
  if (
    !u.silenced &&
    hasTrait(u, 'u18') &&
    source.kind === 'attack' &&
    amount <= COMBAT_RULES.kingAttackImmunity
  ) {
    emit(s, {
      type: 'shield',
      to: u,
      owner: u.owner,
      action: 'ward',
      stage: 'blocked',
      text: '王之蔑视',
    });
    return 0;
  }
  if (!u.silenced && hasTrait(u, 24) && source.path && frontal(source.path, u.owner))
    amount = Math.min(amount, COMBAT_RULES.frontDamageCap);
  const before = u.hp;
  const guardian = amount >= u.hp && availableGuardians(s, u)[0];
  if (guardian) {
    u.hp = 1;
    u.guardSourceIds = [...spentGuardSources(s, u), guardian.id];
    u.guardUsed = true;
    emit(s, {
      type: 'shield',
      to: u,
      owner: u.owner,
      action: 'ward',
      stage: 'blocked',
      text: '名刀',
      actor: eventActor(guardian),
      ability: 3,
    });
  } else u.hp = Math.max(0, Math.round((u.hp - amount) * 1e6) / 1e6);
  const loss = before - u.hp;
  if (loss)
    emit(
      s,
      { type: 'damage', to: u, unitId: u.id, amount: loss, owner: u.owner },
      `${definition(u.kind).name}受到${loss}伤害`,
    );
  if (loss > 0) {
    u.receivedDamage = (u.receivedDamage ?? []).filter((r) => r.ply >= s.ply - 1);
    const current = u.receivedDamage.find((r) => r.ply === s.ply);
    if (current) current.amount += loss;
    else u.receivedDamage.push({ ply: s.ply, amount: loss });
  }
  if (u.hp <= u.maxHp) delete u.overMaxFromBanner;
  if (loss > 0 && !u.silenced && hasTrait(u, 'u10')) u.attackBonus += 15;
  const snap = structuredClone(u);
  const origin = source.base
    ? targets(s).find((t) => t.id === `base-${source.base}`)
    : source.unit
      ? targets(s).find((t) => t.id === source.unit!.id)
      : undefined;
  if (u.hp <= 0) kill(s, u, source, ctx);
  if (
    loss > 0 &&
    hasTrait(snap, 'slayer') &&
    passive(s, snap) &&
    origin &&
    origin.id !== u.id &&
    source.kind !== 'reflect'
  ) {
    if (origin)
      damage(
        s,
        origin,
        loss * COMBAT_RULES.slayerReflectRate,
        { owner: snap.owner, unit: snap, kind: 'reflect', retaliated: true },
        ctx,
      );
  }
  if (
    loss > 0 &&
    !snap.silenced &&
    hasTrait(u, 16) &&
    source.unit &&
    source.owner === u.owner &&
    source.unit.id !== u.id
  )
    s.pending.push({ kind: 'reflect', owner: u.owner, source: snap, amount: loss });
  if (
    loss > 0 &&
    alive(s, u) &&
    !u.silenced &&
    hasTrait(u, 'u18') &&
    origin &&
    origin.id !== u.id &&
    !has(s, u, 'freeze') &&
    !has(s, u, 'stun')
  ) {
    const pair = `${u.id}>${origin.id}`;
    if (!ctx.retaliations.has(pair) && attackPath(s, u, origin, getStats(s, u).range)) {
      ctx.retaliations.add(pair);
      performAttack(s, u, origin, ctx, { reactive: true, forceHostile: true });
    }
  }
  return loss;
}
export function freeze(s: GamePosition, t: Target, source: Source, ctx: Resolution, extra = 0) {
  if (
    !t.unit ||
    !alive(s, t.unit) ||
    hasWeapon(t.unit, 'u28') ||
    protectedEffect(s, t, source, ctx)
  )
    return;
  t.unit.effects = t.unit.effects.filter((e) => e.type !== 'freeze');
  addEffect(s, t.unit, 'freeze', source.owner!, 0, 4, 5 + extra, source.unit?.id);
  emit(s, {
    type: 'shield',
    to: t,
    owner: source.owner,
    action: 'freeze',
    stage: 'trigger',
    text: '冰冻 · 无法行动',
  });
}
export function burn(s: GamePosition, t: Target, source: Source, ctx: Resolution) {
  if (!t.unit || !alive(s, t.unit) || protectedEffect(s, t, source, ctx)) return;
  t.unit.effects = t.unit.effects.filter((e) => e.type !== 'burn');
  addEffect(s, t.unit, 'burn', source.owner!, 0, 12, 5, source.unit?.id);
  emit(s, {
    type: 'skill',
    to: t,
    owner: source.owner,
    action: 'burn',
    stage: 'trigger',
    text: '灼烧',
  });
}
function knockback(s: GamePosition, u: Unit, t: Target, path: Point[], ctx: Resolution) {
  if (!t.unit || !alive(s, t.unit) || path.length < 2) return;
  if (protectedEffect(s, t, { owner: u.owner, unit: u, kind: 'skill' }, ctx)) return;
  const victim = t.unit,
    a = path.at(-2)!,
    b = path.at(-1)!,
    dx = b.x - a.x,
    dy = b.y - a.y;
  const first = { x: victim.x + dx, y: victim.y + dy },
    second = { x: victim.x + 2 * dx, y: victim.y + 2 * dy };
  const behind = [
    ...new Set(
      [...cells({ ...victim, ...first }), ...cells({ ...victim, ...second })]
        .flatMap((p) => occupants(s, p))
        .filter((v) => v.id !== victim.id),
    ),
  ];
  if (behind.some((v) => v.size > 1) || behind.length > 1) return;
  if (behind.length === 1) {
    const follower = behind[0],
      to = { x: follower.x + dx, y: follower.y + dy };
    if (
      canPlace(s, victim, first, false, [follower.id]) &&
      canPlace(s, follower, to, false, [victim.id])
    ) {
      emit(s, {
        type: 'move',
        from: follower,
        to,
        unitId: follower.id,
        owner: follower.owner,
        text: '连带击退',
      });
      Object.assign(follower, to);
      emit(s, {
        type: 'move',
        from: victim,
        to: first,
        unitId: victim.id,
        owner: victim.owner,
        text: '击退',
      });
      Object.assign(victim, first);
    }
    return;
  }
  if (cells({ ...victim, ...second }).some((p) => p.x < 1 || p.x > 9 || p.y < 1 || p.y > 13)) {
    damage(s, t, 30, { owner: u.owner, unit: u, kind: 'skill' }, ctx);
    return;
  }
  if (canPlace(s, victim, first) && canPlace(s, victim, second)) {
    emit(s, {
      type: 'move',
      from: victim,
      to: second,
      unitId: victim.id,
      owner: victim.owner,
      text: '击退',
    });
    Object.assign(victim, second);
  }
}
interface AttackOptions {
  path?: Point[];
  mode?: string;
  hits?: { id: string; actual: number }[];
  direction?: import('./types').AttackDirection;
  reactive?: boolean;
  unlimited?: boolean;
  forceHostile?: boolean;
  amount?: number;
  noPierce?: boolean;
  weaponFirst?: boolean;
}
/** Resolve a hit without spending mode resources. Command layer owns operation counters. */
export function performAttack(
  s: GamePosition,
  u: Unit,
  t: Target,
  ctx = resolution(),
  options: AttackOptions = {},
) {
  const ally = t.unit ? allegiance(s, t.unit) === u.owner : t.owner === u.owner;
  const healing =
    !options.forceHostile &&
    (definition(u.kind).attack < 0 ||
      (!u.silenced && hasTrait(u, 's14')) ||
      (signedAttack(u)
        ? options.mode === 'heal' || (options.mode === undefined && ally)
        : healingAttack(u) && ally));
  ensure(
    options.mode === undefined || options.mode === 'heal' || options.mode === 'damage',
    '请选择伤害或治疗。',
  );
  ensure(!healing || !!t.unit, '治疗攻击只能选择棋子。');
  ensure(
    options.mode !== 'heal' || healingAttack(u) || definition(u.kind).attack < 0,
    '该棋子不能选择治疗。',
  );
  const hits = options.hits ?? [];

  const result = withEventFacts(
    s,
    {
      action: healing ? 'mend' : 'attack',
      actor: eventActor(u),
      subject: eventActor(t),
    },
    () => resolveAttack(s, u, t, ctx, { ...options, hits, mode: healing ? 'heal' : 'damage' }),
  );
  // Clear once per complete attack, including immune/execution hits and piercing volleys.
  // An invalid attack throws before reaching this point and never spends charge.
  if (!options.noPierce) {
    if (hasTrait(u, 15)) consumeCharge(u, 15);
    const charged = attackChargeKind(u);
    if (charged !== undefined) consumeCharge(u, charged);
  }
  if (!options.noPierce && !options.reactive && !u.silenced) {
    if (hasTrait(u, 's3')) {
      const convert = random(s, [0, 1 / 3, 1]) < 1 / 3;
      const victim = t.unit;
      if (
        convert &&
        victim &&
        alive(s, victim) &&
        allegiance(s, victim) === other(u.owner) &&
        !isShrine(victim) &&
        !hasTrait(victim, 5) &&
        hits.some((h) => h.id === victim.id && h.actual > 0) &&
        !protectedEffect(s, asTarget(victim), { owner: u.owner, unit: u, kind: 'skill' }, ctx)
      ) {
        victim.owner = u.owner;
        victim.offset = 0;
        victim.born = s.turns[u.owner] - (hasTrait(victim, 23) ? 1 : 0);
        victim.effects = [];
        resetUnit(s, victim);
        victim.operations = 1;
        emit(s, {
          type: 'skill',
          to: victim,
          owner: u.owner,
          action: 'conversion',
          text: 'CX · 策反',
        });
      }
      if (random(s, [0, 1 / 4, 1]) < 1 / 4) {
        s.summonSlots++;
        emit(s, { type: 'summon', owner: u.owner, text: 'CX · 本回合额外召唤+1' });
      }
    }
    if (hasTrait(u, 's12') && random(s, [0, 3 / 5, 1]) < 3 / 5 && alive(s, u)) {
      u.extraOperations = (u.extraOperations ?? 0) + 1;
      emit(s, { type: 'skill', to: u, owner: u.owner, text: '先攻 · 额外完整操作+1' });
    }
  }
  return result;
}
function resolveAttack(
  s: GamePosition,
  u: Unit,
  t: Target,
  ctx: Resolution,
  options: AttackOptions,
) {
  const ally = t.unit ? allegiance(s, t.unit) === u.owner : t.owner === u.owner;
  ensure(
    !ally ||
      options.forceHostile ||
      (t.unit && (canAttackFriend(u, t.unit) || options.mode === 'heal')),
    '该棋子不能对所选友方进行这种攻击。',
  );
  ensure(t.id !== u.id || options.mode === 'heal', '不能通过普通攻击自杀；玉碎使用独立命令。');
  ensure(
    (t.id === u.id && options.mode === 'heal') ||
      topTarget(s, t) ||
      (piercing(u) && t.unit && isLandmark(t.unit)),
    '非穿透攻击优先命中地标上的友方棋子或叠放栈顶。',
  );
  const stats = getStats(s, u);
  ensure(u.silenced || !hasTrait(u, 'firelord'), '炎魔之王不能普通攻击；沉默会移除此限制。');
  const charged = attackChargeKind(u);
  if (!options.reactive && !options.noPierce && charged !== undefined)
    ensure(
      chargeFor(u, charged).readyCharge >= 1 && chargeFor(u, charged).chargeType === 'attack',
      '半速攻击需要在回合开始已有1层攻击蓄力。',
    );
  if (!options.reactive) {
    ensure(
      !hasTrait(u, 4) || u.silenced || chargeFor(u, 4).readyCharge >= 2,
      '定炮回合开始至少有2层蓄力才可开炮。',
    );
    ensure(
      !hasTrait(u, 9) || u.silenced || !u.attacked.includes(t.id),
      '射手不能重复攻击本回合的同一目标。',
    );
  }
  const canPierce = piercing(u) && !ally && options.mode !== 'heal';
  const limit = options.unlimited ? 117 : stats.range;
  let path: Point[] | null;
  if (options.path) {
    ensure(
      canPierce && validAttackRoute(s, u, options.path, limit),
      '穿透路径不合法：须从自身边缘逐格延伸，不得回绕、超距或穿过敌方基地。',
    );
    ensure(
      options.noPierce || piercingTargets(s, u, options.path).some((v) => v.target.id === t.id),
      '路径必须命中选定敌方目标。',
    );
    path = options.path;
  } else if (canPierce && !hasWeapon(u, 'u28')) {
    // Native Slayer retains its original cardinal-ray mode. Heart adds arbitrary paths;
    // the equipment must not rewrite unrelated innate targeting contracts.
    const rays = cells(u)
      .flatMap((from) =>
        (t.unit ? cells(t.unit) : [t])
          .filter(
            (to) =>
              (from.x === to.x || from.y === to.y) &&
              distance(from, to) > 0 &&
              distance(from, to) <= limit,
          )
          .map((to) => ({ from, to, length: distance(from, to) })),
      )
      .sort((a, b) => a.length - b.length);
    const ray = rays[0];
    path = cells(u).some((p) => (t.unit ? cells(t.unit) : [t]).some((q) => equal(p, q)))
      ? [{ x: t.x, y: t.y }]
      : null;
    if (ray) {
      const dx = Math.sign(ray.to.x - ray.from.x),
        dy = Math.sign(ray.to.y - ray.from.y);
      path = [ray.from];
      for (let i = 1; i <= limit; i++) {
        const p = { x: ray.from.x + dx * i, y: ray.from.y + dy * i };
        if (!inside(p)) break;
        path.push(p);
        if (equal(p, basePoint(other(u.owner)))) break;
      }
    }
  } else path = attackPath(s, u, t, limit, options.direction, canPierce);
  ensure(path, '目标不在射程内，或所选攻击路径被阻挡。');
  if (canPierce && !options.noPierce && path.length > 1) {
    const victims = piercingTargets(s, u, path);
    for (const { target: victim, path: prefix } of victims)
      if (alive(s, u) && (!victim.unit || alive(s, victim.unit)))
        performAttack(s, u, victim, ctx, {
          ...options,
          direction: undefined,
          path: prefix,
          noPierce: true,
          amount: stats.attack,
          weaponFirst: !u.weaponFirstUsed,
        });
    if (hasWeapon(u, 'u11')) u.weaponFirstUsed = true;
    return;
  }
  ctx.retaliations.add(`${u.id}>${t.id}`);
  emit(s, {
    type: 'attack',
    from: u,
    to: t,
    path,
    unitId: u.id,
    owner: u.owner,
    text: options.mode === 'heal' ? '治疗' : '攻击',
    ultimate: definition(u.kind).tier !== 'normal',
  });
  if (options.mode === 'heal' && !options.forceHostile) {
    if (!protectedEffect(s, t, { owner: u.owner, unit: u, kind: 'skill' }, ctx)) {
      heal(
        s,
        t,
        definition(u.kind).attack < 0 || hasTrait(u, 's14')
          ? 20
          : signedAttack(u)
            ? Math.abs(definition(u.kind).attack)
            : hasTrait(u, 2)
              ? 20
              : 25,
        ctx,
      );
      if (t.unit && alive(s, t.unit) && hasWeapon(u, 's16'))
        addEffect(s, t.unit, 'attack', u.owner, 0, 2, -15, u.id, true);
    }
    return;
  }
  const skillSource: Source = { owner: u.owner, unit: u, kind: 'skill' };
  const execute =
    !ally && t.unit && u.effects.find((e) => e.type === 'execute' && activeEffect(s, e, u));
  if (execute && t.unit) {
    u.effects = u.effects.filter((e) => e !== execute);
    if (!protectedEffect(s, t, skillSource, ctx)) {
      const start = s.events.length;
      kill(s, t.unit, skillSource, ctx);
      const death = s.events.slice(start).find((e) => e.type === 'death' && e.unitId === t.id);
      if (death) {
        death.action = 'execution';
        death.stage = 'trigger';
      }
    }
    return;
  }
  const marks =
    !ally && !hasTrait(u, 10)
      ? targetEffects(s, t).filter(
          (e) => e.type === 'mark' && e.owner === u.owner && activeEffect(s, e, t.unit),
        )
      : [];
  // One allied follow-up consumes every active stack, even if an earlier packet kills.
  for (const mark of marks) removeEffect(s, t, mark);
  let amount = options.amount ?? stats.attack;
  for (const kind of abilityKinds(u)) {
    const profile = attackProfile(kind, amount, u.kills, u.silenced, !t.unit);
    amount = profile.packets[0].damage;
    if (profile.cuts) {
      const roll = random(s, profile.cuts),
        index = profile.cuts.slice(1).findIndex((cut) => roll < cut);
      amount = profile.packets[index < 0 ? profile.packets.length - 1 : index].damage;
    }
  }
  const wounded = t.unit ? Math.max(0, t.unit.maxHp - t.unit.hp) : 300 - s.bases[t.owner];
  const reflected =
    !u.silenced && hasTrait(u, 's6')
      ? (u.receivedDamage ?? []).filter((v) => v.ply >= s.ply - 1).reduce((n, v) => n + v.amount, 0)
      : 0;
  const lifesteal = !u.silenced
    ? hasTrait(u, 'slayer')
      ? 1
      : hasTrait(u, 'u8')
        ? vampireRate(u.kills)
        : 0
    : 0;
  // Conversion requires damage from the attack itself, not a secondary mark explosion.
  const packet: Source = {
    owner: u.owner,
    unit: u,
    kind: 'attack',
    path,
    creditFriendly: ally && (signedAttack(u) || hasTrait(u, 's5')),
  };
  const attackLoss = damage(s, t, amount, packet, ctx);
  options.hits?.push({ id: t.id, actual: attackLoss });
  let loss = attackLoss;
  if (hasWeapon(u, 's15') && wounded > 0) loss += damage(s, t, wounded, packet, ctx);
  if (reflected > 0) loss += damage(s, t, reflected, packet, ctx);
  if (
    t.unit &&
    alive(s, t.unit) &&
    hasWeapon(u, 's16') &&
    !protectedEffect(s, t, { owner: u.owner, unit: u, kind: 'skill' }, ctx)
  )
    addEffect(s, t.unit, 'attack', u.owner, 0, 2, -15, u.id, true);

  if (hasTrait(u, 10) && !u.silenced && !ally) {
    const e: Effect = {
      type: 'mark',
      owner: u.owner,
      sourceId: u.id,
      from: s.ply,
      until: s.ply + 2,
      global: true,
    };
    targetEffects(s, t).push(e);
    if (t.unit ? t.unit.hp >= t.unit.maxHp : s.bases[t.owner] >= 300) {
      removeEffect(s, t, e);
      loss += damage(
        s,
        t,
        COMBAT_RULES.catapultMarkDamage,
        { owner: u.owner, unit: u, kind: 'attack', path },
        ctx,
      );
    } else
      emit(s, {
        type: 'skill',
        to: t,
        owner: u.owner,
        action: 'mark',
        stage: 'apply',
        text: '标记',
      });
  }
  // Keep separate packets: each stack has its own immunity/death resolution.
  for (let i = 0; i < marks.length; i++) {
    const start = s.events.length;
    loss += damage(
      s,
      t,
      COMBAT_RULES.catapultMarkDamage,
      { owner: u.owner, unit: u, kind: 'status' },
      ctx,
    );
    const hit = s.events.slice(start).find((e) => e.type === 'damage' && e.unitId === t.id);
    if (hit) {
      hit.action = 'mark';
      hit.stage = 'trigger';
    }
  }
  let drain = lifesteal;
  if (hasWeapon(u, 'u11') && (options.weaponFirst ?? !u.weaponFirstUsed)) drain += 1;
  if (loss > 0 && drain > 0) {
    const start = s.events.length;
    heal(s, u, loss * drain, ctx);
    for (const event of s.events.slice(start))
      if (event.type === 'heal') {
        event.action = 'siphon';
        event.actor = eventActor(t);
        event.from = { x: t.x, y: t.y };
      }
  }
  // The first-attack weapon applies to this complete attack, not to every turn hit.
  if (hasWeapon(u, 'u11') && options.weaponFirst === undefined) u.weaponFirstUsed = true;
  if (!u.silenced && hasTrait(u, 'u2')) consumeCharge(u, 'u2');
  if (!u.silenced && hasTrait(u, 4)) consumeCharge(u, 4);
  const victim = t.unit;
  if (victim && alive(s, victim) && !ally) {
    const conversion = u.effects.find((e) => e.type === 'convert' && activeEffect(s, e, u));
    if (conversion && attackLoss > 0) {
      u.effects = u.effects.filter((e) => e !== conversion);
      if (hasTrait(victim, 5))
        emit(s, {
          type: 'shield',
          to: victim,
          owner: victim.owner,
          action: 'conversion',
          stage: 'blocked',
          text: '大肉比 · 无法策反',
        });
      if (!hasTrait(victim, 5) && !protectedEffect(s, t, skillSource, ctx)) {
        victim.owner = u.owner;
        victim.offset = 0;
        victim.born = s.turns[u.owner] - (hasTrait(victim, 23) ? 1 : 0);
        victim.effects = [];
        resetUnit(s, victim);
        victim.operations = 1;
        emit(
          s,
          {
            type: 'skill',
            to: victim,
            owner: u.owner,
            action: 'conversion',
            stage: 'trigger',
            text: '策反',
          },
          `${definition(victim.kind).name}加入${faction(u.owner)}`,
        );
        return;
      }
    }
    if (!u.silenced && hasTrait(u, 'u4') && !protectedEffect(s, t, skillSource, ctx)) {
      victim.silenced = true;
      addEffect(s, victim, 'stun', u.owner, 0, 2, undefined, u.id);
      emit(s, {
        type: 'skill',
        to: victim,
        owner: u.owner,
        action: 'silence',
        stage: 'trigger',
        text: '沉默 · 眩晕',
      });
    }
    if (hasWeapon(u, 'u5')) freeze(s, t, skillSource, ctx);
    if (hasWeapon(u, 'u28') || (!u.silenced && hasTrait(u, 'u6') && !hasWeapon(u, 'u5')))
      burn(s, t, skillSource, ctx);
    if (!u.silenced && hasTrait(u, 'u20')) knockback(s, u, t, path, ctx);
    if (hasTrait(u, 'formless') && passive(s, u) && alive(s, u))
      s.pending.push({
        kind: 'hit-pull',
        owner: u.owner,
        source: structuredClone(u),
        targetId: victim.id,
        amount: 0,
      });
  } else if (victim && !ally && attackLoss > 0)
    u.effects = u.effects.filter((e) => !(e.type === 'convert' && activeEffect(s, e, u)));
}
export function pruneSiphons(s: GamePosition) {
  s.siphons = s.siphons.filter((l) => {
    const u = s.units.find((v) => v.id === l.sourceId),
      a = targets(s).find((t) => t.id === l.fromId),
      b = targets(s).find((t) => t.id === l.toId);
    return (
      u &&
      passive(s, u) &&
      a &&
      b &&
      attackPath(s, u, a, getStats(s, u).range) &&
      attackPath(s, u, b, getStats(s, u).range)
    );
  });
}

/** Capture covered cells BEFORE any packet changes occupancy or kills a target.
 * Each cell is an independent damage packet (immunity rolls, rage, guard and reflection).
 * Callers select full-stack spells vs top-layer skills and hostile-only vs intentional friendly fire. */
export function areaDamage(
  s: GamePosition,
  victims: Target[],
  amountAt: (p: Point) => number,
  source: Source,
  ctx: Resolution,
) {
  const packets = victims.flatMap((t) =>
    (t.unit ? cells(t.unit) : [t])
      .map((p) => ({ t, amount: amountAt(p) }))
      .filter((p) => p.amount > 0),
  );
  for (const { t, amount } of packets) damage(s, t, amount, source, ctx);
}
