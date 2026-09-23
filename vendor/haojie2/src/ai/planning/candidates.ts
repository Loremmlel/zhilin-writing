import { expansionAnchors } from '../../engine/core/geometry';
import {
  canRestoreClock,
  commandSummonPool,
  damageBonus,
  healingBlocked,
} from '../../engine/setup/shrines';
import {
  hasTrait,
  abilityKinds,
  allPieces,
  isLandmark,
  signedAttack,
  hasAura,
  canAttackFriend,
  canDeployKind,
} from '../../engine/core/traits';
import { regularSummonCommands, summonChoices } from './shrines';
import { availableSyntheses, synthesisDestinations } from '../../engine/setup/synthesis';
import { canSkipReaction, hutSpawnPoints } from '../../engine/commands/reactions';
import { piercing, healingAttack } from '../../engine/core/state';
import { baseCoverValue, payloadCoverValue } from '../evaluation/threats';
import { definition, isStored } from '../../engine/catalog';
import {
  unitActions,
  cardActions,
  reactionAction,
  actionError,
} from '../../engine/commands/options';
import type { ActionSpec, SelectionStep } from '../../engine/commands/options';
import {
  ALL_CELLS,
  basePoint,
  attackPath,
  selectableAttackRoutes,
  canPlace,
  createPlacementQuery,
  deploymentRows,
  cells,
  distance,
  equal,
  neighbors,
  occupants,
  targets,
  topTarget,
} from '../../engine/core/geometry';
import { allegiance, asTarget, getStats, isRunner, template } from '../../engine/core/state';
import type { Command, GameState, Point, Target, Unit } from '../../engine/types';
import { DIFFICULTIES } from '../difficulty';
import type { Difficulty } from '../types';
import { placementValue, unitValue, materialValue } from '../evaluation/evaluate';
import {
  markFollowUp,
  payloadOpportunity,
  hitPackets,
  readyAttack,
  attackPressure,
} from '../evaluation/threats';
import { has, now, passive } from '../../engine/core/state';
import { decisionOwner } from '../observation';
import { hitDistance } from '../evaluation/spatial';
export interface CandidateGroup {
  family: string;
  commands: Command[];
  keep: number;
  priority?: number;
}
const releaseCache = new WeakMap<GameState, Map<string, number>>();
/** 移走廉价掩护可能为已蓄力友方打开原本被阻挡的基地射线。 */
function laneRelease(s: GameState, blocker: Unit): number {
  let cache = releaseCache.get(s);
  if (!cache) {
    cache = new Map();
    releaseCache.set(s, cache);
  }
  const old = cache.get(blocker.id);
  if (old !== undefined) return old;
  const owner = decisionOwner(s),
    defender = owner === 1 ? 2 : 1;
  const target = { id: `base-${defender}`, owner: defender as 1 | 2, ...basePoint(defender) };
  let value = 0;
  for (const ally of s.units)
    if (
      ally.owner === owner &&
      readyAttack(s, ally) &&
      !Number.isFinite(hitDistance(s, ally, target)) &&
      Number.isFinite(hitDistance(s, ally, target, blocker.id))
    ) {
      const damage = attackPressure(s, ally, target, blocker.id);
      value = Math.max(value, damage >= s.bases[defender] ? 200 : Math.min(80, damage * 0.8));
    }
  cache.set(blocker.id, value);
  return value;
}
function targetRank(s: GameState, a: ActionSpec, c: Command, t: Target): number {
  const owner = decisionOwner(s),
    friend = (t.unit ? allegiance(s, t.unit) : t.owner) === owner;
  const caster =
    allPieces(s).find((u) => u.id === c.unitId) ??
    (c.type === 'react' ? s.pending[0]?.source : undefined);
  const cardKind = s.hands[s.active].find((v) => v.id === c.cardId)?.kind;
  if (caster?.kind === 10 && !caster.silenced && !friend) {
    const follow = markFollowUp(s, t, owner, s.ply + 2);
    const immediate = t.unit ? t.unit.hp === t.unit.maxHp : s.bases[t.owner] === 300;
    return (
      (immediate ? 5 : 0) +
      follow * (t.unit ? 12 + materialValue(s, t.unit) * 0.25 : 15) +
      (t.unit && immediate ? materialValue(s, t.unit) * 0.08 : 0)
    );
  }
  if (c.type === 'cast' && (cardKind === 18 || cardKind === 22) && t.unit) {
    const type = cardKind === 18 ? 'execute' : 'convert';
    const carrier = {
      ...t.unit,
      effects: [
        ...t.unit.effects,
        { type, owner, from: s.ply + 2, until: s.ply + 3, global: true },
      ],
    } as Unit;
    const view = { ...s, units: s.units.map((v) => (v.id === carrier.id ? carrier : v)) };
    return payloadOpportunity(view, carrier, type, (v) => materialValue(view, v));
  }
  if (!t.unit) return friend ? (300 - s.bases[t.owner]) * 0.6 : 80 + (300 - s.bases[t.owner]);
  const u = t.unit,
    value = unitValue(s, u);
  if (c.type === 'attack' || c.type === 'react') {
    if (c.mode === 'heal' || (friend && c.mode !== 'damage')) return (u.maxHp - u.hp) * 2;
    if (friend) return -value;
    const shots = caster ? getStats(s, caster).remaining : 1;
    const packets = caster ? hitPackets(s, caster, t) : [];
    const burst = packets.length === 1 && caster?.kind !== 9 && caster?.kind !== 10 ? shots : 1;
    const killChance = packets.reduce(
      (p, hit) => p + (hit.damage * burst >= u.hp ? hit.probability : 0),
      0,
    );
    return value + killChance * (value * 0.7 + 20) + laneRelease(s, u);
  }
  if (a.id === 'siphon')
    return c.targetId
      ? friend
        ? (u.maxHp - u.hp) * 3 + 10
        : -value
      : friend
        ? -value
        : value + 30;
  if (a.id === 'sacrifice-summon') return 30 - value;
  if (a.id === 'reforge-two' || a.id === 'sacrifice')
    return -value + (a.id === 'sacrifice' ? getStats(s, u).attack : 0);
  return friend ? value : value + 30;
}
/** 为窄策略推演提供低成本排序，不能替代引擎校验。 */
export function commandPriority(s: GameState, c: Command): number {
  const u = allPieces(s).find((v) => v.id === c.unitId);
  const t = targets(s).find((v) => v.id === c.targetId);
  const owner = decisionOwner(s);
  if (c.type === 'end' || c.type === 'finish-mode') return -0.1;
  if (
    c.type === 'skip-synthesis' ||
    c.type === 'summon' ||
    c.type === 'begin' ||
    c.type === 'react'
  )
    return 1000;
  if (c.type === 'deploy') return 80;
  if (c.type === 'attack' && u && t) {
    if (t.owner === owner && t.unit) {
      if (c.mode === 'heal' || (c.mode !== 'damage' && healingAttack(u)))
        return healingBlocked(s, owner)
          ? 0
          : Math.max(0, Math.min(t.unit.maxHp - t.unit.hp, Math.abs(definition(u.kind).attack))) *
              0.8;
      const gain = hasTrait(u, 's5') && abilityKinds(t.unit).some((k) => !hasTrait(u, k)) ? 65 : 0;
      return gain - materialValue(s, t.unit) * 0.8;
    }
    const hp = t.unit?.hp ?? s.bases[t.owner];
    const packets = hitPackets(s, u, t, c.direction);
    const damage = packets.reduce((v, p) => v + p.probability * Math.min(hp, p.damage), 0);
    const kill = packets.reduce((v, p) => v + (p.damage >= hp ? p.probability : 0), 0);
    return (
      damage * (t.unit ? 0.65 : 3.1) +
      kill * (t.unit ? materialValue(s, t.unit) : 100000) +
      (has(s, u, 'execute') || has(s, u, 'convert') ? 100 : 0) +
      (u.kind === 10 ? markFollowUp(s, t, owner, s.ply + 2) * 5 : 0)
    );
  }
  if (c.type === 'move' && u && c.x !== undefined && c.y !== undefined)
    return placementValue(s, u, { x: c.x, y: c.y }) - placementValue(s, u, u) + 0.5;
  if (c.type === 'skill' && u?.kind === 14 && t?.unit?.kind === 14) return 30;
  if (c.type === 'charge') return 8;
  if (c.type === 'cast' || c.type === 'equip') return 12;
  return 6;
}
function pointRank(s: GameState, a: ActionSpec, c: Command, p: Point, u?: Unit): number {
  if (
    c.type === 'move' ||
    c.type === 'deploy' ||
    a.id === 'dash' ||
    a.id === 'revive' ||
    a.id === 'hut-spawn'
  ) {
    const k = s.hands[s.active].find((v) => v.id === c.cardId)?.kind;
    const ghost =
      u ??
      template(
        a.id === 'hut-spawn'
          ? 20
          : c.deathId
            ? (s.deaths.find((d) => d.id === c.deathId)?.kind ?? 1)
            : (k ?? 1),
        decisionOwner(s),
        0,
        p,
      );
    let value =
      placementValue(s, ghost, p) +
      baseCoverValue(s, { ...ghost, ...p }) +
      payloadCoverValue(s, { ...ghost, ...p }, (v) => materialValue(s, v));
    if (c.type === 'move' && u) {
      const cards = s.hands[u.owner].filter((c) => canDeployKind(c.kind));
      if (cards.length) {
        const before = deploymentRows(s, u.owner);
        const view = { ...s, units: s.units.map((v) => (v.id === u.id ? { ...v, ...p } : v)) };
        const gained = deploymentRows(view, u.owner).filter((y) => !before.includes(y));
        // 仅为可实际落子的增援保留推进候选；最终搜索继续比较暴露、反击和不推进。
        if (
          gained.length &&
          cards.some((card) =>
            ALL_CELLS.some(
              (at) =>
                gained.includes(at.y) &&
                canPlace(view, template(card.kind, u.owner, 0, at), at, true),
            ),
          )
        )
          value += Math.min(2, cards.length) * 8;
      }
    }
    if (isRunner(ghost))
      value += occupants(s, p)
        .filter((v) => v.id !== ghost.id && v.owner !== ghost.owner)
        .reduce((n, v) => n + Math.min(30, v.hp) + 10, 0);
    return value;
  }
  if (a.id === 'wall')
    return (
      baseCoverValue(s, template('wall', decisionOwner(s), 0, p)) +
      payloadCoverValue(s, template('wall', decisionOwner(s), 0, p), (v) => materialValue(s, v)) -
      (u ? distance(p, u) * 0.1 : 0)
    );
  if (a.id === 'hook') {
    const victim = allPieces(s).find((v) => v.id === c.targetId);
    if (victim) return -placementValue(s, victim, p);
  }
  if (a.id === 'blast' || a.id === 'cross' || a.id === 'ice-mark') {
    let value = 0;
    for (const t of targets(s)) {
      if ((t.unit ? allegiance(s, t.unit) : t.owner) === decisionOwner(s)) continue;
      const amount = (t.unit ? cells(t.unit) : [t]).reduce(
        (n, q) =>
          n +
          (a.id === 'blast'
            ? q.x >= p.x && q.x <= p.x + 1 && q.y >= p.y && q.y <= p.y + 1
              ? 20
              : 0
            : a.id === 'cross'
              ? (q.x === p.x || q.y === p.y) &&
                u &&
                Math.abs(q.x - u.x) <= 5 &&
                Math.abs(q.y - u.y) <= 5
                ? equal(q, p)
                  ? 40
                  : 20
                : 0
              : equal(q, p)
                ? 20
                : 0),
        0,
      );
      if (amount) value += t.unit ? Math.min(t.unit.hp, amount) + 15 : amount * 2;
    }
    return value;
  }
  return u ? -distance(p, u) : 0;
}
interface FinalFilter {
  rows?: number[];
  targetId?: string;
}
// 过滤器仅在最后的参数选择步骤下推，不能改变中间步骤的 partial 截断结果。
function points(
  s: GameState,
  a: ActionSpec,
  c: Command,
  filter?: FinalFilter,
  rank = true,
): Point[] {
  const u =
    allPieces(s).find((v) => v.id === c.unitId) ??
    (c.type === 'react' ? s.pending[0]?.source : undefined);
  if ((c.type === 'move' && u && (isRunner(u) || u.size > 1)) || a.id === 'bounce')
    return u ? neighbors(u) : [];
  if (a.id === 'giant') {
    const v = allPieces(s).find((v) => v.id === c.targetId);
    return v ? expansionAnchors(s, v) : [];
  }
  if (a.id === 'hut-spawn') {
    const raw = hutSpawnPoints(s, s.pending[0]);
    return rank
      ? raw.sort((aPoint, bPoint) => pointRank(s, a, c, bPoint, u) - pointRank(s, a, c, aPoint, u))
      : raw;
  }
  const query = createPlacementQuery(s);
  const card = c.type === 'deploy' ? s.hands[s.active].find((v) => v.id === c.cardId) : undefined;
  const ghost = card ? template(card.kind, s.active, s.turns[s.active], ALL_CELLS[0]) : undefined;
  const st = u ? getStats(s, u) : undefined;
  const moveLimit = st ? (st.move % 1 ? st.move * 2 : st.move) : 0;
  const straight = !!u && hasTrait(u, 13) && !u.silenced;
  const hooked = a.id === 'hook' ? allPieces(s).find((v) => v.id === c.targetId) : undefined;
  const all = ALL_CELLS.filter((p) => {
    if (filter?.rows && !filter.rows.includes(p.y)) return false;
    if (c.type === 'deploy') {
      return !!ghost && query.canPlace(ghost, p, true);
    }
    if (c.type === 'move' && u) {
      const limit = moveLimit;
      return distance(u, p) <= limit && !!query.movementPath(u, p, limit, straight);
    }
    if (a.id === 'dash' && u) return distance(u, p) <= 6 && !!query.movementPath(u, p, 6);
    if (a.id === 'blast') return p.x < 9 && p.y < 13;
    if ((a.id === 'cross' || a.id === 'ice-mark') && u)
      return Math.abs(p.x - u.x) <= 5 && Math.abs(p.y - u.y) <= 5;
    if (a.id === 'hook' && u) {
      const v = hooked;
      return (
        !!v &&
        !equal(v, p) &&
        query.canPlace(v, p) &&
        !!attackPath(s, u, asTarget({ ...v, ...p }), st!.range)
      );
    }
    if (a.id === 'wall' && u)
      return query.canPlace(template('wall', u.owner, 0, p), p) && !!attackPath(s, u, p, st!.range);
    if (a.id === 'revive' || a.id === 'hut-spawn') return !!u && distance(p, u) <= st!.range + 1;
    return true;
  });
  if (!rank) return all;
  const ranked = all.map((p) => ({ p, score: pointRank(s, a, c, p, u) }));
  return ranked.sort((a, b) => b.score - a.score).map((v) => v.p);
}
function choices(
  s: GameState,
  a: ActionSpec,
  c: Command,
  step: SelectionStep,
  filter?: FinalFilter,
): Command[] {
  if (step.kind === 'path') return []; // AI 使用引擎生成的有界方向路径，不枚举任意手绘路径。
  if (step.kind === 'target') {
    const u =
      allPieces(s).find((v) => v.id === c.unitId) ??
      (c.type === 'react' ? s.pending[0]?.source : undefined);
    const view = u && a.id === 'dash' && c.x !== undefined ? { ...u, x: c.x, y: c.y! } : u;
    return targets(s)
      .filter((t) => {
        if (filter?.targetId !== undefined && t.id !== filter.targetId) return false;
        if (step.unitOnly && !t.unit) return false;
        const side = t.unit ? allegiance(s, t.unit) : t.owner,
          owner = decisionOwner(s);
        if (step.relation === 'friend' && side !== owner) return false;
        if (step.relation === 'enemy' && side === owner) return false;
        if (c.sacrificeIds?.includes(t.id) || c.targetId === t.id) return false;
        if (
          step.field === 'sacrificeIds' &&
          (!t.unit || t.unit.kind === 'u25' || t.unit.hp * 2 < t.unit.maxHp)
        )
          return false;
        if (a.id === 'giant' && (!t.unit || t.id === u?.id || !expansionAnchors(s, t.unit).length))
          return false;
        if (a.id === 'sacrifice-summon' && (t.id === u?.id || t.unit?.kind !== 14)) return false;
        if (a.id === 'sacrifice' && (t.id === u?.id || t.unit?.kind === 'u25')) return false;
        // 友方法术可指定某个克隆；攻击仍遵守栈顶规则。
        if (c.type === 'attack' || c.type === 'react') {
          if (
            !topTarget(s, t) &&
            !(
              view &&
              ((healingAttack(view) && t.id === view.id && c.mode !== 'damage') ||
                (piercing(view) && t.unit && isLandmark(t.unit)))
            )
          )
            return false;
          if (
            view &&
            side === owner &&
            t.unit &&
            !view.silenced &&
            healingAttack(view) &&
            c.mode !== 'damage' &&
            t.unit.hp >= t.unit.maxHp
          )
            return false;
          if (
            view?.kind === 10 &&
            passive(s, view) &&
            t.unit?.kind === 'u18' &&
            passive(s, t.unit) &&
            t.unit.hp === t.unit.maxHp &&
            getStats(s, view).attack <= 10 &&
            !has(s, view, 'execute') &&
            !has(s, view, 'convert') &&
            !piercing(view)
          )
            return false;
          // 不为零伤害且零效果的命中消耗可见行动或束搜索名额。
          // 标记、处决、灼烧、装备等真实命中机制仍保留为候选。
          if (
            view &&
            side !== owner &&
            getStats(s, view).attack === 0 &&
            damageBonus(s, { owner: view.owner, unit: view, kind: 'attack' }) === 0 &&
            !(
              passive(s, view) &&
              (hasTrait(view, 10) ||
                hasTrait(view, 'u6') ||
                hasTrait(view, 's3') ||
                hasTrait(view, 's12'))
            ) &&
            !has(s, view, 'execute') &&
            !has(s, view, 'convert') &&
            !view.equipment.some((k) => ['u5', 's15', 's16'].includes(String(k))) &&
            !piercing(view) &&
            !t.unit?.effects.some((e) => e.type === 'mark' && e.owner === owner && e.until > s.ply)
          )
            return false;
          if (
            view?.kind === 10 &&
            !view.silenced &&
            side !== owner &&
            getStats(s, view).attack === 0 &&
            !has(s, view, 'execute') &&
            !has(s, view, 'convert') &&
            !(t.unit ? t.unit.hp === t.unit.maxHp : s.bases[t.owner] === 300) &&
            !markFollowUp(s, t, owner, s.ply + 2)
          )
            return false;
          if (
            side === owner &&
            !(
              view &&
              t.unit &&
              (canAttackFriend(view, t.unit) || (c.mode === 'heal' && healingAttack(view)))
            )
          )
            return false;
        }
        if (
          step.range &&
          view &&
          (piercing(view)
            ? !Number.isFinite(hitDistance(s, view, t))
            : !attackPath(s, view, t, getStats(s, view).range))
        )
          return false;
        return true;
      })
      .map((t) => ({ t, score: targetRank(s, a, c, t) }))
      .sort((x, y) => y.score - x.score)
      .map(({ t }) =>
        step.field === 'sacrificeIds'
          ? { ...c, sacrificeIds: [...(c.sacrificeIds ?? []), t.id] }
          : { ...c, [step.field ?? 'targetId']: t.id },
      );
  }
  if (step.kind === 'point') return points(s, a, c, filter).map((p) => ({ ...c, ...p }));
  if (step.kind === 'death')
    return s.deaths
      .filter(
        (d) =>
          d.kind !== 'grave' &&
          d.owner === s.active &&
          !d.revived &&
          s.ply - d.ply <= 4 &&
          s.ply > d.ply,
      )
      .sort((a, b) => definition(b.kind).attack - definition(a.kind).attack)
      .map((d) => ({ ...c, deathId: d.id }));
  const lines = Array.from({ length: step.kind === 'row' ? 13 : 9 }, (_, i) => ({
    ...c,
    [step.kind]: i + 1,
  }));
  const lineValue = (command: Command) =>
    targets(s).reduce((score, t) => {
      const hit = (t.unit ? cells(t.unit) : [t]).filter((p) =>
        step.kind === 'row' ? p.y === command.row : p.x === command.column,
      ).length;
      if (!hit || (t.owner === decisionOwner(s) && c.type === 'cast')) return score;
      return (
        score +
        (t.owner === decisionOwner(s) ? -1 : 1) *
          (t.unit
            ? Math.min(20 * hit, t.unit.hp) + (t.unit.hp <= 20 * hit ? materialValue(s, t.unit) : 0)
            : 25)
      );
    }, 0);
  return lines.sort((a, b) => lineValue(b) - lineValue(a));
}
function expand(s: GameState, a: ActionSpec, partial: number, filter?: FinalFilter): Command[] {
  let drafts = [a.command];
  for (let i = 0; i < a.steps.length; i++) {
    const last = i === a.steps.length - 1;
    drafts = drafts.flatMap((c) => {
      const next = choices(s, a, c, a.steps[i], last ? filter : undefined);
      return last ? next : next.slice(0, partial);
    });
  }
  if (a.command.type === 'attack')
    return drafts.flatMap((c) => {
      const u = allPieces(s).find((u) => u.id === c.unitId),
        t = targets(s).find((t) => t.id === c.targetId);
      const routes = u && t ? selectableAttackRoutes(s, u, t) : [];
      return routes.length > 1 ? routes.map((r) => ({ ...c, direction: r.direction })) : [c];
    });
  return drafts;
}
/** 所有难度共用的候选分组，每条最终命令仍由引擎验证。分组保留准备技能和多个行动者，不只按即时伤害裁剪。 */
export function* iterateCandidateGroups(
  s: GameState,
  difficulty: Difficulty,
  deferPointRanking = false,
): Generator<CandidateGroup> {
  if (s.winner) return;
  const settings = DIFFICULTIES[difficulty];
  const make = (a: ActionSpec): CandidateGroup | null => {
    const identity = a.id;
    a = { ...a, id: a.id.split(':')[0] };
    if (actionError(s, a)) return null;
    // 仅延迟优先级与落点无关的一步动作；先用原枚举确认非空，保留原组序、分数及所有备选。
    // getter 只供搜索内部的不可变快照使用，不把近似估分用于组筛选。
    if (
      deferPointRanking &&
      a.steps.length === 1 &&
      a.steps[0].kind === 'point' &&
      ['deploy', 'skill', 'cast'].includes(a.command.type) &&
      !commandSummonPool(s, a.command)
    ) {
      if (!points(s, a, a.command, undefined, false).length) return null;
      let commands: Command[] | undefined;
      return {
        family: `${a.command.unitId ?? a.command.cardId ?? 'system'}:${identity}`,
        get commands() {
          return (commands ??= expand(s, a, settings.partial));
        },
        priority: commandPriority(s, a.command),
        keep: settings.perAction,
      };
    }
    const commands = expand(s, a, settings.partial).flatMap((c) => {
      const pool = commandSummonPool(s, c);
      return pool ? summonChoices(s, c, pool === 'ultimate') : [c];
    });
    return commands.length
      ? {
          family: `${a.command.unitId ?? a.command.cardId ?? 'system'}:${identity}`,
          commands,
          priority: commandPriority(s, commands[0]),
          keep: a.command.type === 'attack' ? Math.max(8, settings.perAction) : settings.perAction,
        }
      : null;
  };
  const emit = function* (a: ActionSpec) {
    const group = make(a);
    if (group) yield group;
  };
  if (s.pending.length) {
    yield* emit(reactionAction(s)!);
    if (canSkipReaction(s))
      yield { family: 'reaction-skip', commands: [{ type: 'react' }], keep: 1 };
    return;
  }
  if (s.phase === 'shrine-draft') {
    const p = s.active;
    for (const kind of s.shrineDraft?.offers[p] ?? [])
      yield {
        family: 'draft',
        commands: [
          {
            type: 'choose-shrine',
            player: p,
            shrineKind: kind,
            ...(kind === 's9' ? { parity: 'odd' as const } : {}),
          },
        ],
        keep: 1,
      };
    return;
  }
  if (s.phase === 'shrine-setup') {
    for (const c of s.hands[s.active]) for (const a of cardActions(s, c)) yield* emit(a);
    yield { family: 'shrine-store', commands: [{ type: 'finish-shrine-setup' }], keep: 1 };
    return;
  }
  if (s.summonOffer) {
    const commands: Command[] = [];
    for (let i = 0; i < s.summonOffer.groups.length; i++)
      for (let j = i + 1; j < s.summonOffer.groups.length; j++)
        commands.push({ type: 'choose-summons', offerIndices: [i, j] });
    yield { family: 'choose-summons', commands, keep: commands.length };
    return;
  }
  if (s.phase === 'synthesis') {
    // 即使工作量预算最小，也必须保留不合成的选项。
    yield {
      family: 'synthesis-skip',
      commands: [{ type: 'skip-synthesis' }],
      keep: 1,
      priority: 1000,
    };
    for (const { recipe, ids } of availableSyntheses(s)) {
      const cost = (id: string) => {
        const u = allPieces(s).find((v) => v.id === id);
        return u ? unitValue(s, u) : 0;
      };
      const ranked = [...ids].sort((a, b) => cost(a) - cost(b));
      const sets = new Map<string, string[]>();
      // 优先最便宜的三材料，并保留能腾出不同部署格的替代组合；
      // 这是有界选择而非组合穷举，玩家仍可选择任意合法三材料。
      for (const id of ranked) {
        const trio = [id, ...ranked.filter((v) => v !== id).slice(0, 2)];
        sets.set([...trio].sort().join('|'), trio);
      }
      let accepted = 0;
      for (const materialIds of sets.values()) {
        if (definition(recipe.result).aura) {
          yield {
            family: `synthesis:${recipe.id}`,
            keep: 1,
            priority: 80,
            commands: [{ type: 'synthesize', recipeId: recipe.id, materialIds }],
          };
          break;
        }
        const destinations = synthesisDestinations(s, recipe, materialIds);
        if (!destinations.length) continue;
        const view = {
          ...s,
          units:
            recipe.source === 'board'
              ? s.units.filter((u) => !materialIds.includes(u.id))
              : s.units,
        };
        const ghost = template(recipe.result, s.active, s.turns[s.active], destinations[0]);
        destinations.sort(
          (a, b) => placementValue(view, ghost, b) - placementValue(view, ghost, a),
        );
        yield {
          family: `synthesis:${recipe.id}:${accepted}`,
          keep: settings.perAction,
          priority: 80,
          commands: destinations.map((p) => ({
            type: 'synthesize',
            recipeId: recipe.id,
            materialIds,
            ...p,
          })),
        };
        if (++accepted >= (difficulty === 'easy' ? 1 : 3)) break;
      }
    }
    return;
  }
  if (s.phase === 'summon') {
    yield {
      family: 'summon',
      keep: 2,
      commands: s.summonSlots > 0 ? regularSummonCommands(s) : [{ type: 'begin' }],
    };
    if (s.mode === 'shrine') {
      for (const ultimate of [false, true])
        if (s.heads[s.active] >= (ultimate ? 3 : 2))
          yield {
            family: `head-summon:${ultimate}`,
            keep: 3,
            commands: summonChoices(s, { type: 'extra-summon', ultimate }, ultimate),
          };
    }
    for (const c of s.hands[s.active])
      for (const a of cardActions(s, c)) if (a.command.type === 'reroll') yield* emit(a);
    return;
  }
  const transit = allPieces(s).find(
    (u) => hasTrait(u, 'u12p') && !hasTrait(u, 'u12') && u.mode === 'move' && !canPlace(s, u, u),
  );
  if (transit) {
    for (const a of unitActions(s, transit)) if (a.id === 'move') yield* emit(a);
    return;
  }
  if (s.summonSlots > 0)
    yield {
      family: 'bonus-summon',
      keep: 2,
      priority: 1000,
      commands: regularSummonCommands(s),
    };
  const actions = allPieces(s)
    .filter((u) => u.owner === s.active)
    .flatMap((u) => unitActions(s, u));
  actions.sort((a, b) => Number(b.command.type === 'attack') - Number(a.command.type === 'attack'));
  for (const a of actions) yield* emit(a);
  if (hasAura(s, s.active, 's10'))
    yield {
      family: 'clock',
      keep: 5,
      commands: s.units
        .filter((u) => canRestoreClock(s, u))
        .map((u) => ({ type: 'clock', targetId: u.id })),
    };
  for (const c of s.hands[s.active]) for (const a of cardActions(s, c)) yield* emit(a);
  yield { family: 'end', commands: [{ type: 'end' }], keep: 1 };
}
export function candidateGroups(s: GameState, difficulty: Difficulty): CandidateGroup[] {
  return [...iterateCandidateGroups(s, difficulty)];
}

/** 推进行权后的短续招，只枚举新开放行的合法部署，仍复用手牌模式与落点评分。 */
export function deploymentCandidates(s: GameState, rows: number[]): Command[] {
  return s.hands[s.active].flatMap((card) =>
    cardActions(s, card)
      .filter((a) => a.command.type === 'deploy')
      .flatMap((a) =>
        expand(s, a, 1, a.steps.length === 1 && a.steps[0].kind === 'point' ? { rows } : undefined)
          .filter((c) => c.y !== undefined && rows.includes(c.y))
          .slice(0, 2),
      ),
  );
}

/** 低成本战术续招：复用目标规则，不枚举全部移动。 */
export function attackCandidates(s: GameState, id: string, targetId?: string): Command[] {
  const unit = allPieces(s).find((u) => u.id === id);
  if (!unit || s.pending.length) return [];
  const action = unitActions(s, unit).find((a) => a.command.type === 'attack');
  if (!action || actionError(s, action)) return [];
  const filter =
    targetId !== undefined &&
    action.steps.length === 1 &&
    action.steps[0].kind === 'target' &&
    (action.steps[0].field ?? 'targetId') === 'targetId'
      ? { targetId }
      : undefined;
  const commands = expand(s, action, 1, filter);
  return targetId === undefined ? commands : commands.filter((c) => c.targetId === targetId);
}
