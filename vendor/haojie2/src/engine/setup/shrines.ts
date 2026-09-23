/** 神龛模式、地标及光环的规则实现，不包含渲染器或 AI 策略。 */
import { summonPool } from './summoning';
import { definition, SHRINE_POOL, SUMMON_POOL, ULTIMATE_POOL } from '../catalog';
import {
  ALL_CELLS,
  attackPath,
  canPlace,
  cells,
  equal,
  inside,
  occupants,
  other,
  targets,
  topTarget,
} from '../core/geometry';
import {
  actor,
  addEffect,
  allegiance,
  asTarget,
  chooseMode,
  draw,
  emit,
  ensure,
  findUnit,
  finishOperation,
  getStats,
  now,
  passive,
  random,
  resetUnit,
  template,
} from '../core/state';
import { alive, damage, heal, kill, protectedEffect, type Resolution } from '../commands/combat';
import {
  abilityKinds,
  allPieces,
  anyTrait,
  aura,
  hasAura,
  hasTrait,
  isFollower,
  isLandmark,
  isMage,
  isShrine,
  ordinal,
  refusesWeapons,
  weaponHealth,
} from '../core/traits';
import type {
  Aura,
  Card,
  ClockFrame,
  Command,
  GamePosition,
  Kind,
  Landmark,
  Player,
  Source,
  Unit,
} from '../types';

export const landmarkAt = (s: GamePosition, p: { x: number; y: number }) =>
  s.landmarks?.find((l) => equal(l, p));
export const liveLandmark = (l?: Landmark): l is Landmark & { dormantSince: undefined } =>
  !!l && l.hp > 0 && l.dormantSince === undefined;
export function landmarkSquare(kind: Kind, p: { x: number; y: number }): boolean {
  const rule = definition(kind).landmark;
  return (
    !!rule &&
    inside(p) &&
    (rule.allowed ? rule.allowed.some((q) => equal(p, q)) : p.y >= 6 && p.y <= 8)
  );
}

/** 永久地标独立分层，不产生尸体或免费人头。 */
export function demolish(s: GamePosition, l: Landmark) {
  l.hp = 0;
  l.dormantSince = s.ply;
  l.rebuildTicks = 0;
  l.mode = 'none';
  emit(
    s,
    { type: 'death', to: l, unitId: l.id, owner: l.owner, text: '地标休眠' },
    `${definition(l.kind).name}被摧毁，等待重建`,
  );
  syncBanners(s);
}
export function rebuildLandmarks(s: GamePosition) {
  for (const l of s.landmarks ?? []) {
    if (l.owner !== s.active) continue;
    if (l.dormantSince !== undefined && s.ply > l.dormantSince) {
      l.rebuildTicks = Math.min(definition(l.kind).landmark!.rebuild, (l.rebuildTicks ?? 0) + 1);
      if (
        l.rebuildTicks >= definition(l.kind).landmark!.rebuild &&
        occupants(s, l).every((u) => allegiance(s, u) === l.owner)
      ) {
        delete l.dormantSince;
        delete l.rebuildTicks;
        l.hp = l.maxHp;
        l.silenced = false;
        l.effects = [];
        emit(
          s,
          { type: 'spawn', to: l, unitId: l.id, owner: l.owner, text: '地标重建' },
          `${definition(l.kind).name}已重建`,
        );
      }
    }
    if (liveLandmark(l)) resetUnit(s, l);
  }
  syncBanners(s);
}
export function bannerCount(s: GamePosition, owner: Player): number {
  return (s.landmarks ?? []).filter(
    (l) => liveLandmark(l) && l.owner === owner && passive(s, l) && hasTrait(l, 's8'),
  ).length;
}
/** 只保存实际施加的生命上限差值，攻击仍由当前局面派生。 */
export function syncBanners(s: GamePosition) {
  const counts = { 1: bannerCount(s, 1), 2: bannerCount(s, 2) };
  for (const u of [...s.units, ...(s.landmarks ?? [])]) {
    const eligible = !isLandmark(u) || liveLandmark(u as Landmark);
    const next = eligible && allegiance(s, u) === u.owner ? 10 * counts[u.owner] : 0;
    const old = u.bannerHp ?? 0;
    if (next !== old) {
      u.maxHp += next - old;
      if (next > old && u.hp > 0) u.hp += next - old;
      u.bannerHp = next;
      if (u.hp > u.maxHp) u.overMaxFromBanner = true;
    }
    if (u.hp <= u.maxHp) delete u.overMaxFromBanner;
  }
}
export function onLandmarkDeployment(s: GamePosition, u: Unit) {
  if (isLandmark(u)) return;
  const l = cells(u)
    .map((p) => landmarkAt(s, p))
    .find((l) => liveLandmark(l) && l.owner === u.owner && hasTrait(l, 's1'));
  if (!liveLandmark(l) || l.owner !== u.owner || !passive(s, l) || !hasTrait(l, 's1')) return;
  const wasCharge = u.chargedOnDeploy;
  // 推进冲锋号令对应的个人时钟，与金身的伤害免疫无关。
  u.offset += 2;
  resetUnit(s, u);
  u.chargedOnDeploy = true;
  if (wasCharge) u.extraOperations = (u.extraOperations ?? 0) + 1;
  emit(s, {
    type: 'skill',
    to: u,
    owner: u.owner,
    ability: 'u17',
    action: 'clock',
    text: wasCharge ? '金晔 · 冲锋与双操作' : '金晔 · 冲锋号令',
  });
}
export function damageBonus(s: GamePosition, source: Source): number {
  if (source.owner === undefined || ['sacrifice', 'expire'].includes(source.kind)) return 0;
  let bonus = hasAura(s, source.owner, 's11') ? 5 : 0;
  if (
    source.kind === 'spell' ||
    (['skill', 'status'].includes(source.kind) && source.unit && isMage(source.unit))
  )
    bonus +=
      15 *
      allPieces(s).filter((u) => u.owner === source.owner && hasTrait(u, 's14') && passive(s, u))
        .length;
  return bonus;
}
export const healingBlocked = (s: GamePosition, owner: Player) => hasAura(s, other(owner), 's11');
export function endShrines(s: GamePosition, ctx: Resolution) {
  for (const source of [...s.units])
    if (
      source.owner === s.active &&
      hasTrait(source, 's4') &&
      passive(s, source) &&
      alive(s, source)
    )
      for (const friend of allPieces(s))
        if (
          allegiance(s, friend) === source.owner &&
          attackPath(s, source, asTarget(friend), getStats(s, source).range)
        )
          heal(s, friend, friend.maxHp - friend.hp, ctx);
}

export function initializeShrines(s: GamePosition) {
  s.mode = 'shrine';
  s.phase = 'shrine-draft';
  s.ply = 0;
  s.summonSlots = 0;
  s.auras = { 1: [], 2: [] };
  s.landmarks = [];
  s.shrineSetupDone = [];
  const offers = {} as Record<Player, Kind[]>;
  for (const p of [1, 2] as Player[]) {
    const pool = [...SHRINE_POOL];
    offers[p] = [];
    for (let i = 0; i < 3; i++) {
      const index = Math.floor(
        random(
          s,
          Array.from({ length: pool.length + 1 }, (_, n) => n / pool.length),
        ) * pool.length,
      );
      offers[p].push(pool.splice(index, 1)[0]);
    }
  }
  s.shrineDraft = { offers, committed: { 1: false, 2: false }, choices: {}, revealed: false };
  emit(
    s,
    { type: 'turn', text: '第0回合 · 秘密选择神龛' },
    '双方各抽3个神龛；双方锁定后同时公布选择',
  );
}
export function validateShrineChoice(s: GamePosition, c: Command) {
  const d = s.shrineDraft,
    p = c.player;
  ensure(s.phase === 'shrine-draft' && d && !d.revealed, '当前不是神龛选择阶段。');
  ensure(p === 1 || p === 2, '请选择作出决定的一方。');
  ensure(!d.committed[p], '这一方已经锁定，不可改选。');
  ensure(
    c.shrineKind !== undefined && d.offers[p].includes(c.shrineKind),
    '只能选择本方三个候选中的一个。',
  );
  ensure(
    c.shrineKind !== 's9' || ['odd', 'even'].includes(c.parity ?? ''),
    '玉碎需要同时选择奇数或偶数。',
  );
  return { draft: d, player: p, kind: c.shrineKind };
}
export function chooseShrine(s: GamePosition, c: Command) {
  const { draft: d, player: p, kind } = validateShrineChoice(s, c);
  d.choices[p] = { kind, ...(c.shrineKind === 's9' ? { parity: c.parity } : {}) };
  d.committed[p] = true;
  emit(s, { type: 'turn', owner: p, text: '神龛已锁定' }, '一方已锁定神龛，等待另一方');
  if (!d.committed[other(p)]) {
    s.active = other(p);
    return;
  }
  // 权威局面拥有双方提交；脱敏观察绝不能执行共同揭示。
  ensure(d.choices[1] && d.choices[2], '等待另一方的保密选择；观察视图不能代替权威对局。');
  d.revealed = true;
  s.active = 1;
  s.phase = 'shrine-setup';
  for (const owner of [1, 2] as Player[]) {
    const choice = d.choices[owner]!;
    s.hands[owner].push({
      id: `c${s.serial++}`,
      kind: choice.kind,
      drawnAt: 0,
      summonedPly: 0,
      ...(choice.parity ? { parity: choice.parity } : {}),
    });
    emit(
      s,
      { type: 'summon', owner, text: definition(choice.kind).name, ultimate: true },
      `${owner}方揭示：${definition(choice.kind).name}${choice.parity ? (choice.parity === 'odd' ? ' · 奇数' : ' · 偶数') : ''}`,
    );
  }
}
export function activateAura(s: GamePosition, c: Command) {
  const card = s.hands[s.active].find((v) => v.id === c.cardId);
  ensure(card && definition(card.kind).aura, '请选择光环牌。');
  ensure(!hasAura(s, s.active, card.kind), '这个永久光环已经启用。');
  s.auras ??= { 1: [], 2: [] };
  const entry: Aura = { kind: card.kind, ...(card.parity ? { parity: card.parity } : {}) };
  if (card.kind === 's9') ensure(entry.parity, '玉碎的开局奇偶选择缺失。');
  s.auras[s.active].push(entry);
  s.hands[s.active] = s.hands[s.active].filter((v) => v.id !== card.id);
  emit(s, { type: 'skill', owner: s.active, text: `永久光环 · ${definition(card.kind).name}` });
}
export function grantLaoqian(s: GamePosition) {
  s.auras ??= { 1: [], 2: [] };
  ensure(!hasAura(s, s.active, 'laoqian'), '牢千K光环已经存在，不能重复消耗材料。');
  s.auras[s.active].push({ kind: 'laoqian' });
  emit(
    s,
    { type: 'skill', owner: s.active, text: '合成 · 牢千K' },
    '3名改判小法师合成永久自选召唤光环牢千K',
  );
}
export function selectableSummons(ultimate: boolean): Kind[] {
  return ultimate ? [...ULTIMATE_POOL] : [...SUMMON_POOL];
}
export const canChooseSummon = (s: GamePosition, p: Player = s.active) => {
  const a = aura(s, p, 'laoqian');
  return !!a && a.usedPly !== s.ply;
};
export function consumeChosenSummon(s: GamePosition, owner: Player, kind: Kind, ultimate: boolean) {
  ensure(canChooseSummon(s, owner), '本回合牢千K自选召唤已使用，或尚未获得光环。');
  ensure(selectableSummons(ultimate).includes(kind), '自选结果必须属于本次召唤的来源池。');
  aura(s, owner, 'laoqian')!.usedPly = s.ply;
}
export function summon(s: GamePosition, c: Command) {
  ensure(!s.summonOffer, '先从候选召唤中选出两个结果。');
  ensure(s.summonSlots > 0, '本回合召唤次数已用完。');
  const shrine = s.mode === 'shrine';
  if (shrine)
    ensure(
      c.ultimate !== false || c.mode !== 'normal',
      '常驻召唤使用终极池；普通池需消耗2人头额外召唤。',
    );
  const ultimate = shrine || !!c.ultimate;
  if (!shrine && ultimate) {
    ensure(s.heads[s.active] >= 2, '终极召唤需要2人头。');
    s.heads[s.active] -= 2;
  }
  if (shrine && (s.regularSummons ?? 0) === 2 && hasAura(s, s.active, 's13')) {
    const count = random(s, [0, 1 / 3, 1]) < 1 / 3 ? 4 : 3;
    const groups: Card[][] = [];
    for (let i = 0; i < count; i++)
      groups.push(draw(s, s.active, 1, true, i === 0 ? c.chosenKind : undefined));
    const ids = new Set(groups.flat().map((v) => v.id));
    s.hands[s.active] = s.hands[s.active].filter((v) => !ids.has(v.id));
    s.summonOffer = { owner: s.active, groups, count: 2 };
    s.summonSlots -= 2;
    s.regularSummons = 0;
    return;
  }
  draw(s, s.active, 1, ultimate, c.chosenKind);
  s.summonSlots--;
  if (shrine && (s.regularSummons ?? 0) > 0) s.regularSummons!--;
}
export function chooseSummons(s: GamePosition, c: Command) {
  const offer = s.summonOffer,
    indices = c.offerIndices ?? [];
  ensure(offer && offer.owner === s.active, '当前没有待选的召唤结果。');
  ensure(
    indices.length === 2 &&
      new Set(indices).size === 2 &&
      indices.every((i) => Number.isInteger(i) && i >= 0 && i < offer.groups.length),
    '请选择两个不同的完整召唤结果。',
  );
  for (const index of indices) s.hands[s.active].push(...offer.groups[index]);
  delete s.summonOffer;
  emit(s, { type: 'summon', owner: s.active, text: '老千K · 选定两个结果' });
}
export function extraSummon(s: GamePosition, c: Command) {
  ensure(
    s.mode === 'shrine' && s.phase === 'summon' && !s.summonOffer,
    '人头额外召唤仅限神龛模式回合开始。',
  );
  const ultimate = c.ultimate !== false,
    cost = ultimate ? 3 : 2;
  ensure(s.heads[s.active] >= cost, `本次${ultimate ? '终极' : '普通'}召唤需要${cost}人头。`);
  s.heads[s.active] -= cost;
  draw(s, s.active, 1, ultimate, c.chosenKind);
}

/** 时钟快照有界，每方两份，不包含 PRNG 或历史。 */
export function captureClockFrame(s: GamePosition) {
  if (
    !hasAura(s, 1, 's10') &&
    !hasAura(s, 2, 's10') &&
    ![...s.hands[1], ...s.hands[2]].some((c) => c.kind === 's10')
  )
    return;
  s.clockFrames ??= { 1: {}, 2: {} };
  const f = s.clockFrames[s.active];
  if (f.current) f.previous = f.current;
  else delete f.previous;
  f.current = { ply: s.ply, turns: { ...s.turns }, units: structuredClone(s.units) };
}
function restoredUnit(s: GamePosition, u: Unit): Unit {
  const frame = s.clockFrames?.[s.active].previous;
  const old = frame?.units.find((v) => v.id === u.id);
  if (old && frame) {
    const restored = structuredClone(old),
      shift = s.ply - frame.ply;
    restored.born += s.turns[restored.owner] - frame.turns[restored.owner];
    restored.effects = restored.effects.map((e) => ({
      ...e,
      from: e.from + shift,
      until: Math.min(Number.MAX_SAFE_INTEGER, e.until + shift),
    }));
    for (const field of ['hookReadyAt', 'hookExpiresAt', 'expiresAt'] as const)
      if (restored[field] !== undefined) restored[field]! += shift;
    // 恢复时刷新每实际回合一次的能力，与冲锋号令的个人时钟推进不同。
    if (restored.freeUsed >= 0) restored.freeUsed += shift;
    if (restored.lastCharge >= 0) restored.lastCharge += shift;
    for (const c of Object.values(restored.abilityCharges ?? {}))
      if (c && c.lastCharge >= 0) c.lastCharge += shift;
    if (restored.rerollUsedPly !== undefined) restored.rerollUsedPly += shift;
    if (restored.abilityUsage)
      for (const usage of Object.values(restored.abilityUsage))
        if (usage && usage.free >= 0) usage.free += shift;
    if (restored.receivedDamage)
      restored.receivedDamage = restored.receivedDamage.map((r) => ({ ...r, ply: r.ply + shift }));
    return restored;
  }
  ensure(
    u.owner !== s.active && (!frame || u.deployedAt > frame.ply),
    '目标在上一个己方回合没有快照，且不是敌方新召唤棋子。',
  );
  const restored = template(u.kind, u.owner, s.turns[u.owner], u, u.id);
  restored.deployedAt = u.deployedAt;
  restored.born = u.born;
  restored.chargedOnDeploy = u.chargedOnDeploy;
  if (u.kind === 1 && u.chargedOnDeploy) {
    restored.maxHp -= 10;
    restored.hp -= 10;
  }
  if (u.group) restored.group = u.group;
  return restored;
}
export function canRestoreClock(s: GamePosition, u: Unit): boolean {
  if (
    s.phase !== 'play' ||
    s.pending.length ||
    !hasAura(s, s.active, 's10') ||
    aura(s, s.active, 's10')!.usedPly === s.ply ||
    isShrine(u) ||
    isLandmark(u)
  )
    return false;
  try {
    const restored = restoredUnit(s, u);
    if (!canPlace(s, restored, restored, false, [u.id])) return false;
    return restored.equipment.every((k) => {
      const id = definition(k).tier === 'shrine' ? restored.equipmentIds?.[k] : undefined;
      return (
        !id ||
        (![...s.hands[1], ...s.hands[2]].some((c) => c.id === id) &&
          !s.units.some((v) => v.id !== u.id && Object.values(v.equipmentIds ?? {}).includes(id)))
      );
    });
  } catch {
    return false;
  }
}
export function clockRestore(s: GamePosition, c: Command, ctx: Resolution) {
  const a = aura(s, s.active, 's10');
  ensure(s.phase === 'play' && a && a.usedPly !== s.ply, '时钟每个实际己方回合只能使用一次。');
  const u = findUnit(s, c.targetId);
  ensure(!isShrine(u) && !isLandmark(u), '时钟不能对神龛或地标生效。');
  const restored = restoredUnit(s, u);
  ensure(canPlace(s, restored, restored, false, [u.id]), '时钟原位置被占或不再合法；未消耗次数。');
  for (const k of restored.equipment) {
    if (definition(k).tier !== 'shrine') continue;
    const id = restored.equipmentIds?.[k];
    if (!id) continue;
    ensure(
      ![...s.hands[1], ...s.hands[2]].some((v) => v.id === id) &&
        !s.units.some((v) => v.id !== u.id && Object.values(v.equipmentIds ?? {}).includes(id)),
      '原神龛武器已经转移，不能通过时钟复制。',
    );
  }
  a.usedPly = s.ply;
  if (!protectedEffect(s, asTarget(u), { owner: s.active, kind: 'skill' }, ctx)) {
    s.units[s.units.findIndex((v) => v.id === u.id)] = restored;
    syncBanners(s);
    emit(s, {
      type: 'skill',
      from: u,
      to: restored,
      unitId: u.id,
      owner: s.active,
      action: 'clock',
      text: '时钟 · 状态复原',
    });
  }
}
export function canShatter(s: GamePosition, u: Unit): boolean {
  const a = aura(s, u.owner, 's9'),
    n = ordinal(u.kind);
  return !!a && isFollower(u.kind) && n !== null && (n % 2 === 1 ? 'odd' : 'even') === a.parity;
}
export function shatter(s: GamePosition, c: Command, ctx: Resolution) {
  const u = actor(s, c.unitId);
  ensure(canShatter(s, u), '玉碎只对所选奇偶编号的友方随从开放。');
  chooseMode(s, u, 'skill');
  const t = targets(s).find((v) => v.id === c.targetId);
  ensure(
    t && (t.unit ? allegiance(s, t.unit) : t.owner) === other(u.owner) && topTarget(s, t),
    '玉碎需要一个敌方目标。',
  );
  ensure(attackPath(s, u, t, getStats(s, u).range), '玉碎目标不在攻击范围内。');
  const amount = Math.max(0, Math.ceil((getStats(s, u).attack + u.hp) / 10) * 5),
    source = structuredClone(u);
  kill(s, u, { owner: u.owner, unit: source, kind: 'sacrifice', ignoreHead: true }, ctx);
  damage(s, t, amount, { owner: source.owner, unit: source, kind: 'skill' }, ctx);
  emit(s, { type: 'skill', from: source, to: t, owner: source.owner, text: '玉碎' });
}

/** 装备只有一个槽；转移或返还保留卡牌身份，防止时钟复制。 */
export function installEquipment(u: Unit, kind: Kind, id?: string) {
  for (const old of u.equipment) u.maxHp -= weaponHealth(old);
  u.hp = Math.min(u.hp, u.maxHp);
  u.equipment = [kind];
  u.equipmentIds = id ? { [kind]: id } : {};
  u.bladeQualified = false;
  u.maxHp += weaponHealth(kind);
  if (kind === 'u28' || kind === 's2') u.hp += weaponHealth(kind);
  u.hp = Math.min(u.hp, u.maxHp);
  if (kind === 'u28') u.effects = u.effects.filter((e) => e.type !== 'freeze');
  delete u.overMaxFromBanner;
}
export function stealOnKill(s: GamePosition, killer: Unit, victim: Unit) {
  if (killer.silenced || !hasTrait(killer, 's5') || killer.id === victim.id) return;
  killer.traits = [
    ...new Set([
      ...(killer.traits ?? []),
      ...abilityKinds(victim).filter((k) => k !== killer.kind),
    ]),
  ];
  if (victim.equipment.length && !refusesWeapons(killer)) {
    const k = victim.equipment[0];
    // 技能不能强制将法师专用武器转交给不符合条件的持有者。
    const nextMax =
      killer.maxHp -
      killer.equipment.reduce<number>((n, old) => n + weaponHealth(old), 0) +
      weaponHealth(k);
    if (
      nextMax > 0 &&
      ((k !== 'u5' && k !== 's16') || isMage(killer)) &&
      (k !== 'u28' || !isMage(killer))
    ) {
      installEquipment(killer, k, victim.equipmentIds?.[k]);
      // 资格属于新持有者的本次装备期间，不继承前持有者的资格。
      killer.bladeQualified = false;
      victim.equipment = [];
      victim.equipmentIds = {};
    }
  }
  emit(s, {
    type: 'skill',
    from: victim,
    to: killer,
    owner: killer.owner,
    text: 'ZF·强夺 · 获得技能与武器',
  });
}
export function returnDeathWeapons(s: GamePosition, u: Unit) {
  for (const k of u.equipment)
    if (k === 's2' || (k === 's15' && u.bladeQualified)) {
      s.hands[u.owner].push({
        id: u.equipmentIds?.[k] ?? `c${s.serial++}`,
        kind: k,
        drawnAt: s.turns[u.owner],
        summonedPly: s.ply,
      });
      emit(s, { type: 'skill', owner: u.owner, text: `${definition(k).name}返回储存区` });
    }
}

/** 不从随机召唤池抽取的命令返回 undefined。 */
export function commandSummonPool(s: GamePosition, c: Command): 'normal' | 'ultimate' | undefined {
  if (c.type === 'summon') return s.mode === 'shrine' || c.ultimate ? 'ultimate' : 'normal';
  if (c.type === 'extra-summon') return c.ultimate === false ? 'normal' : 'ultimate';
  const card = s.hands[s.active].find((v) => v.id === c.cardId);
  if (c.type === 'reroll' && card) return summonPool(card);
  if (c.type === 'cast' && card?.kind === 25) return s.mode === 'shrine' ? 'ultimate' : 'normal';
  return undefined;
}
