import { chargeFor, consumeCharge, moveChargeKind, hasTrait, isLandmark } from './traits';
import { landmarkAt } from './shrines';
import { hitPullDestination, hutSpawnPoints } from './reactions';
import { protectedEffect } from './combat';
import { eventActor, withEventFacts } from './event-facts';
import { alive, damage, findTarget, performAttack, lowerMax } from './combat';
import type { Resolution } from './combat';
import {
  ALL_CELLS,
  attackPath,
  basePoint,
  canPlace,
  cells,
  distance,
  equal,
  inside,
  key,
  movementPath,
  neighbors,
  occupants,
  targets,
} from './geometry';
import {
  actor,
  addUnit,
  allegiance,
  asTarget,
  chooseMode,
  emit,
  ensure,
  findUnit,
  finishOperation,
  getStats,
  hasWeapon,
  isRunner,
  point,
  template,
} from './state';
import type { Command, GamePosition, Point, Unit } from './types';
export function emptyFor(s: GamePosition, u: Unit, p: Point = u) {
  return (
    canPlace(s, u, p) &&
    cells({ ...u, ...p }).every(
      (c) => !landmarkAt(s, c) && occupants(s, c).every((v) => v.id === u.id),
    )
  );
}
function canEnter(s: GamePosition, u: Unit, p: Point) {
  // Large bodies may never overlap; a single-cell runner may transiently cross ANY layer.
  return u.size > 1 ? canPlace(s, u, p) : inside(p);
}
function reachableExit(s: GamePosition, u: Unit, steps: number) {
  const queue = [{ p: { x: u.x, y: u.y }, steps: 0 }],
    seen = new Set([key(u)]);
  for (let i = 0; i < queue.length; i++) {
    const item = queue[i];
    if (emptyFor(s, u, item.p)) return true;
    if (item.steps >= steps) continue;
    for (const p of neighbors(item.p)) {
      if (seen.has(key(p)) || !canEnter(s, u, p)) continue;
      seen.add(key(p));
      queue.push({ p, steps: item.steps + 1 });
    }
  }
  return false;
}
export function moveUnit(s: GamePosition, c: Command, ctx: Resolution) {
  const u = findUnit(s, c.unitId);
  return withEventFacts(
    s,
    { actor: eventActor(u), ...(isRunner(u) ? { action: 'rush' as const } : {}) },
    () => resolveMove(s, c, ctx),
  );
}
function resolveMove(s: GamePosition, c: Command, ctx: Resolution) {
  const u = actor(s, c.unitId),
    to = point(c.x, c.y),
    starting = u.mode === 'none';
  ensure(!isLandmark(u), '地标不能移动。');
  chooseMode(s, u, 'move');
  const charged = moveChargeKind(u),
    reserve = charged === undefined ? undefined : chargeFor(u, charged);
  if (isRunner(u)) {
    if (starting) {
      ensure(
        reserve && reserve.readyCharge >= 1 && reserve.chargeType === 'move',
        '需要在回合开始已有1层移动蓄力。',
      );
      u.moves = 5;
      consumeCharge(u, charged!);
    }
    ensure(
      u.moves > 0 && distance(u, to) === 1 && canEnter(s, u, to),
      '每次沿四向移动一格，不能越界或使大体型重叠。',
    );
    const t = targets(s).find(
      (t) =>
        t.id !== u.id &&
        (t.unit ? allegiance(s, t.unit) : t.owner) !== u.owner &&
        (t.unit ? cells(t.unit) : [t]).some((p) => equal(p, to)),
    );
    emit(s, { type: 'move', from: u, to, unitId: u.id, owner: u.owner, text: '冲撞' });
    Object.assign(u, to);
    u.moves--;
    if (t) damage(s, t, 30, { owner: u.owner, unit: u, kind: 'collision' }, ctx);
    if (!alive(s, u)) return;
    if (hasTrait(u, 'u12') && t) {
      s.pending.unshift({ kind: 'bounce', owner: u.owner, source: structuredClone(u), amount: 30 });
    } else
      ensure(
        emptyFor(s, u) || (u.moves > 0 && reachableExit(s, u, u.moves)),
        '剩余移动次数无法返回空地，不能进行这次冲撞。',
      );
    if (u.moves === 0 && emptyFor(s, u)) {
      finishOperation(u);
      if (hasWeapon(u, 'u16')) u.bonusAttacks++;
    }
    return;
  }
  let limit = getStats(s, u).move;
  if (u.size > 1) {
    if (starting) {
      if (charged !== undefined) {
        ensure(
          reserve && reserve.readyCharge >= 1 && reserve.chargeType === 'move',
          '分数移动须先蓄力。',
        );
        if (limit % 1) limit *= 2;
      }
      u.moves = Math.floor(limit);
    }
    ensure(
      u.moves > 0 && distance(u, to) === 1 && canPlace(s, u, to),
      '2×2每次整体向一个方向移动一小格，四格均须合法且不能重叠。',
    );
    const path = [{ x: u.x, y: u.y }, to];
    emit(s, { type: 'move', from: u, to, path, unitId: u.id, owner: u.owner });
    Object.assign(u, to);
    if (starting && charged !== undefined) consumeCharge(u, charged);
    u.moves--;
    if (!u.moves) {
      finishOperation(u);
      if (hasWeapon(u, 'u16')) u.bonusAttacks++;
    }
    return;
  }
  if (charged !== undefined) {
    ensure(
      reserve && reserve.readyCharge >= 1 && reserve.chargeType === 'move',
      '分数移动需要在回合开始已有1层移动蓄力。',
    );
    if (limit % 1) limit *= 2;
  }
  const path = movementPath(s, u, to, limit, hasTrait(u, 13) && !u.silenced);
  ensure(path, '移动距离、路径、占位或独行侠禁区不合法。');
  emit(s, { type: 'move', from: u, to, path, unitId: u.id, owner: u.owner });
  Object.assign(u, to);
  if (charged !== undefined) consumeCharge(u, charged);
  finishOperation(u);
  if (hasWeapon(u, 'u16')) u.bonusAttacks++;
}
export function finishMode(s: GamePosition, c: Command) {
  const u = actor(s, c.unitId);
  ensure(
    u.mode === 'attack' || (u.mode === 'move' && (isRunner(u) || u.size > 1)),
    '没有可提前结束的连续操作。',
  );
  ensure(!isRunner(u) || emptyFor(s, u), '必须先移到空地，不能结束在另一个棋子、地标或基地内。');
  const wasMove = u.mode === 'move';
  finishOperation(u);
  if (wasMove && hasWeapon(u, 'u16')) u.bonusAttacks++;
}
export function react(s: GamePosition, c: Command, ctx: Resolution) {
  const r = s.pending.shift();
  ensure(r, '没有待结算反应。');
  if (r.kind === 'bounce') {
    const u = s.units.find((u) => u.id === r.source.id);
    if (!u) return;
    const to = point(c.x, c.y);
    ensure(
      distance(u, to) === 1 && canEnter(s, u, to),
      '必须向四向相邻合法格弹出，不能越界或使大体型重叠。',
    );
    const t = targets(s).find(
      (t) =>
        t.id !== u.id &&
        (t.unit ? allegiance(s, t.unit) : t.owner) !== u.owner &&
        (t.unit ? cells(t.unit) : [t]).some((p) => equal(p, to)),
    );
    emit(s, { type: 'move', from: u, to, unitId: u.id, owner: u.owner, text: '免费弹出' });
    Object.assign(u, to);
    if (t) damage(s, t, 30, { owner: u.owner, unit: u, kind: 'collision' }, ctx);
    if (!alive(s, u)) return;
    if (t || !emptyFor(s, u)) {
      s.pending.unshift({
        kind: 'bounce',
        owner: u.owner,
        source: structuredClone(u),
        amount: 30,
      });
    } else if (u.moves === 0) {
      finishOperation(u);
      if (hasWeapon(u, 'u16')) u.bonusAttacks++;
    }
    return;
  }
  if (r.kind === 'hit-pull') {
    if (c.mode !== 'pull') return;
    const to = hitPullDestination(s, r);
    ensure(to, '原命中目标或来源已失效，或身前没有合法完整落位。');
    const source = findUnit(s, r.source.id),
      victim = findUnit(s, r.targetId);
    if (
      !protectedEffect(
        s,
        { ...victim, unit: victim },
        { owner: r.owner, unit: source, kind: 'skill' },
        ctx,
      )
    ) {
      emit(s, {
        type: 'move',
        action: 'pull',
        stage: 'trigger',
        from: victim,
        to,
        unitId: victim.id,
        owner: victim.owner,
      });
      Object.assign(victim, to);
    }
    return;
  }
  if (r.kind === 'hut-spawn') {
    const hut = s.units.find((u) => u.id === r.source.id);
    const destinations = hutSpawnPoints(s, r);
    if (!hut || !destinations.length) return;
    if (c.x === undefined) {
      ensure(!hasTrait(hut, 'citadel'), '王城死亡召唤必须选择合法落点。');
      emit(s, { type: 'skill', owner: r.owner, text: '放弃召唤' });
      return;
    }
    const to = point(c.x, c.y);
    ensure(
      destinations.some((p) => equal(p, to)),
      '小屋召唤须在其范围内的合法空地。',
    );
    ensure(hut.maxHp >= 10, '小屋生命上限不足。');
    addUnit(s, 20, r.owner, to);
    lowerMax(s, hut, 10, ctx);
    return;
  }
  if (!c.targetId) {
    emit(s, { type: 'skill', owner: r.owner, text: '放弃效果' });
    return;
  }
  const t = findTarget(s, c.targetId);
  if (r.kind === 'death-shot')
    performAttack(s, r.source, t, ctx, { reactive: true, unlimited: true });
  else {
    ensure(
      t.unit ? allegiance(s, t.unit) !== r.owner : t.owner !== r.owner,
      '伤害转化只能指向敌方或中立。',
    );
    const path = attackPath(s, r.source, t, getStats(s, r.source).range);
    ensure(path, '目标不在伤害转化器范围内。');
    emit(s, { type: 'attack', from: r.source, to: t, path, owner: r.owner, text: '伤害转化' });
    damage(s, t, r.amount, { owner: r.owner, unit: r.source, kind: 'reflect' }, ctx);
  }
}
