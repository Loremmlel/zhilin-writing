import { validMatch, type MatchSettings } from '../../match/settings';
import { applyCommand } from '../commands/game';
import { normalizeHornStorage } from './migrations';
import { definition, SHRINE_POOL } from '../catalog';
import { canDeployKind, hasTrait, isLandmark } from '../core/traits';
import { landmarkSquare } from '../setup/shrines';
import { cells, inside, key, basePoint, equal, deploymentRows } from '../core/geometry';
import type { Command, GameState, Player, Unit, Landmark } from '../types';
import {
  startRecord,
  restoreRecord,
  parseRecordedSave,
  parseRuntimeRecord,
  type CommandRecord,
} from './recording';
/** 运行时会话含悔棋缓存；持久化请使用 serializeSession，不能直接序列化缓存。 */
export interface Session {
  format: 'haojie-session-v2';
  match?: MatchSettings;
  humanAnchor?: GameState;
  present: GameState;
  past: GameState[];
  future: GameState[];
  record?: CommandRecord;
  humanAnchorCursor?: number;
}
const LIMIT = 60;
export const createSession = (present: GameState, match?: MatchSettings): Session => ({
  ...(match ? { match: { ...match } } : {}),
  format: 'haojie-session-v2',
  present: {
    ...present,
    deployRows: { 1: deploymentRows(present, 1), 2: deploymentRows(present, 2) },
  },
  past: [],
  future: [],
});
/** 先成功执行规则，再记录旧局面并清空重做；异常不会留下半份历史。 */
export function dispatch(s: Session, c: Command): Session {
  const present = applyCommand(s.present, c);
  const record = s.record ?? startRecord(s.present);
  return {
    ...s,
    present,
    ...(s.match?.mode === 'ai' &&
    (s.present.pending[0]?.owner ?? s.present.active) === s.match.human
      ? { humanAnchor: s.present, humanAnchorCursor: record.cursor }
      : {}),
    past: [...s.past, s.present].slice(-LIMIT),
    future: [],
    record: {
      ...record,
      commands: [...record.commands.slice(0, record.cursor), structuredClone(c)],
      cursor: record.cursor + 1,
    },
  };
}
export function undo(s: Session): Session {
  if (!s.past.length) return s;
  if (s.record && s.record.cursor > 0 && s.match?.mode === 'ai')
    return restoreRecord({ ...s.record, cursor: s.record.cursor - 1 }, s.match);
  return {
    ...s,
    present: s.past.at(-1)!,
    past: s.past.slice(0, -1),
    future: [s.present, ...s.future].slice(0, LIMIT),
    ...(s.record
      ? {
          record: s.record.cursor > 0 ? { ...s.record, cursor: s.record.cursor - 1 } : undefined,
        }
      : {}),
  };
}
export function redo(s: Session): Session {
  if (!s.future.length) return s;
  if (s.record && s.record.cursor < s.record.commands.length) {
    const next = dispatch(s, s.record.commands[s.record.cursor]);
    const record = { ...s.record, cursor: s.record.cursor + 1 };
    return {
      ...next,
      record,
      future:
        s.future.length > 1
          ? s.future.slice(1)
          : record.cursor < record.commands.length
            ? [applyCommand(next.present, record.commands[record.cursor])]
            : [],
    };
  }
  return {
    ...s,
    present: s.future[0],
    past: [...s.past, s.present].slice(-LIMIT),
    future: s.future.slice(1),
    ...(s.record ? { record: undefined, humanAnchorCursor: undefined } : {}),
  };
}
const object = (v: unknown): v is Record<string, any> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown, min = 0, max = 1e9) =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const int = (v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER) =>
  num(v, min, max) && Number.isSafeInteger(v);
const text = (v: unknown, max = 150) => typeof v === 'string' && v.length > 0 && v.length <= max;
const player = (p: unknown) => p === 1 || p === 2;
const list = (v: unknown, max = 2000): v is any[] => Array.isArray(v) && v.length <= max;
const validKind = (k: unknown, unit = false) => {
  try {
    const d = definition(k as Unit['kind']);
    return !unit || canDeployKind(d.id);
  } catch {
    return false;
  }
};
function effects(v: unknown) {
  return (
    list(v, 1000) &&
    v.every(
      (e) =>
        object(e) &&
        [
          'attack',
          'immune',
          'execute',
          'convert',
          'mark',
          'freeze',
          'burn',
          'stun',
          'inner-fire',
        ].includes(e.type) &&
        int(e.from) &&
        int(e.until) &&
        e.until > e.from &&
        player(e.owner) &&
        (e.amount === undefined || num(e.amount, -1e6)) &&
        (e.sourceId === undefined || text(e.sourceId)) &&
        (e.global === undefined || typeof e.global === 'boolean'),
    )
  );
}
function validUnit(u: unknown, dead = false): u is Unit {
  if (
    !object(u) ||
    !text(u.id) ||
    !validKind(u.kind, true) ||
    !player(u.owner) ||
    !inside(u as Unit) ||
    ![1, 2].includes(u.size)
  )
    return false;
  if (
    !num(u.hp, dead ? 0 : 0.000001) ||
    !num(u.maxHp, dead ? 0 : 0.000001) ||
    (u.hp > u.maxHp && u.overMaxFromBanner !== true) ||
    !int(u.born, -1) ||
    !int(u.offset) ||
    !int(u.deployedAt) ||
    typeof u.chargedOnDeploy !== 'boolean' ||
    u.offset % 2 !== 0
  )
    return false;
  if (
    !['none', 'attack', 'move', 'skill', 'charge'].includes(u.mode) ||
    ![
      u.operations,
      u.shots,
      u.moves,
      u.bonusAttacks,
      u.charge,
      u.readyCharge,
      u.upgrades,
      u.kills,
      u.rangeBonus,
    ].every((v) => int(v)) ||
    !num(u.attackBonus, -1e6) ||
    !int(u.lastCharge, -1) ||
    !int(u.freeUsed, -1)
  )
    return false;
  if (
    !['move', 'attack', 'skill'].includes(u.chargeType) ||
    !['bonusSequence', 'weaponFirstUsed', 'guardUsed', 'silenced', 'onceUsed'].every(
      (k) => typeof u[k] === 'boolean',
    )
  )
    return false;
  if (
    !list(u.attacked) ||
    !u.attacked.every((v) => text(v)) ||
    !list(u.equipment, 1) ||
    !u.equipment.every((v) => validKind(v) && definition(v).weapon !== undefined) ||
    !effects(u.effects)
  )
    return false;
  return (
    unitExtensions(u) &&
    (u.group === undefined || text(u.group)) &&
    (u.guardSourceIds === undefined ||
      (list(u.guardSourceIds) &&
        u.guardSourceIds.every((id) => text(id)) &&
        new Set(u.guardSourceIds).size === u.guardSourceIds.length)) &&
    (u.rerollUsedPly === undefined || int(u.rerollUsedPly, 1)) &&
    ['expiresAt', 'hookReadyAt', 'hookExpiresAt'].every((k) => u[k] === undefined || int(u[k]))
  );
}
/** 以增量字段保持旧 v2 存档可读，同时拒绝结构损坏的快照。 */
function unitExtensions(u: Record<string, any>): boolean {
  return (
    (u.traits === undefined ||
      (list(u.traits, 100) &&
        u.traits.every((k) => validKind(k, true)) &&
        new Set(u.traits).size === u.traits.length)) &&
    (u.abilityUsage === undefined ||
      (object(u.abilityUsage) &&
        Object.keys(u.abilityUsage).length <= 100 &&
        Object.entries(u.abilityUsage).every(
          ([k, v]) =>
            validKind(/^\d+$/.test(k) ? Number(k) : k, true) &&
            object(v) &&
            typeof v.once === 'boolean' &&
            int(v.free, -1),
        ))) &&
    (u.abilityCharges === undefined ||
      (object(u.abilityCharges) &&
        Object.entries(u.abilityCharges).length <= 100 &&
        Object.entries(u.abilityCharges).every(
          ([k, c]) =>
            validKind(/^\d+$/.test(k) ? Number(k) : k, true) &&
            object(c) &&
            int(c.charge, 0, 5) &&
            int(c.readyCharge, 0, 5) &&
            c.readyCharge <= c.charge &&
            ['move', 'attack', 'skill'].includes(c.chargeType) &&
            int(c.lastCharge, -1),
        ))) &&
    (u.equipmentIds === undefined ||
      (object(u.equipmentIds) &&
        Object.entries(u.equipmentIds).every(([k, v]) => u.equipment.includes(k) && text(v)))) &&
    (u.extraOperations === undefined || int(u.extraOperations, 0, 1000)) &&
    (u.bannerHp === undefined || (int(u.bannerHp, 0, 1000) && u.bannerHp % 10 === 0)) &&
    (u.overMaxFromBanner === undefined || typeof u.overMaxFromBanner === 'boolean') &&
    (u.bladeQualified === undefined || typeof u.bladeQualified === 'boolean') &&
    (u.receivedDamage === undefined ||
      (list(u.receivedDamage, 2) &&
        u.receivedDamage.every((r) => object(r) && int(r.ply) && num(r.amount)) &&
        new Set(u.receivedDamage.map((r) => r.ply)).size === u.receivedDamage.length))
  );
}
function validCard(c: any, ids: Set<string>, zero: boolean): boolean {
  if (
    !object(c) ||
    !text(c.id) ||
    ids.has(c.id) ||
    !validKind(c.kind) ||
    !int(c.drawnAt) ||
    !int(c.summonedPly, zero ? 0 : 1) ||
    (c.expiresAt !== undefined && !int(c.expiresAt, 1))
  )
    return false;
  if (c.group !== undefined && !text(c.group)) return false;
  if (c.summonPool !== undefined && !['normal', 'ultimate'].includes(c.summonPool)) return false;
  if (c.rerolled !== undefined && typeof c.rerolled !== 'boolean') return false;
  if (c.parity !== undefined && (c.kind !== 's9' || !['odd', 'even'].includes(c.parity)))
    return false;
  ids.add(c.id);
  return true;
}
function shrineFields(
  s: Record<string, any>,
  ids: Set<string>,
  occupied: Map<string, Unit[]>,
): boolean {
  if (s.mode !== undefined && s.mode !== 'shrine') return false;
  if (s.regularSummons !== undefined && !int(s.regularSummons, 0, 2)) return false;
  if (
    s.shrineSetupDone !== undefined &&
    (!list(s.shrineSetupDone, 2) ||
      !s.shrineSetupDone.every(player) ||
      new Set(s.shrineSetupDone).size !== s.shrineSetupDone.length)
  )
    return false;
  if (s.auras !== undefined) {
    if (!object(s.auras)) return false;
    for (const p of [1, 2]) {
      const a = s.auras[p];
      if (
        !list(a, 5) ||
        !a.every(
          (v) =>
            object(v) &&
            validKind(v.kind) &&
            definition(v.kind).aura &&
            (v.kind !== 's9' || ['odd', 'even'].includes(v.parity)) &&
            (v.usedPly === undefined || int(v.usedPly, 0, s.ply)),
        ) ||
        new Set(a.map((v) => v.kind)).size !== a.length
      )
        return false;
    }
  }
  if (s.landmarks !== undefined) {
    if (!list(s.landmarks, 117)) return false;
    const squares = new Set<string>();
    for (const raw of s.landmarks) {
      const l = raw as Landmark;
      if (
        !validUnit(l, l.dormantSince !== undefined) ||
        !isLandmark(l) ||
        l.size !== 1 ||
        ids.has(l.id) ||
        !(
          landmarkSquare(l.kind, l) ||
          (l.kind === 's8' && l.x === 7 && [8, 9, 10].includes(l.y))
        ) ||
        squares.has(key(l))
      )
        return false;
      if (
        l.dormantSince !== undefined &&
        (!int(l.dormantSince, 0, s.ply) ||
          l.hp !== 0 ||
          !int(l.rebuildTicks, 0, definition(l.kind).landmark!.rebuild))
      )
        return false;
      if (l.dormantSince === undefined && (l.hp <= 0 || l.rebuildTicks !== undefined)) return false;
      const occupants = occupied.get(key(l)) ?? [];
      if (occupants.length > 1 && !occupants.some((u) => hasTrait(u, 'u12') || hasTrait(u, 'u12p')))
        return false;
      squares.add(key(l));
      ids.add(l.id);
    }
  }
  if (s.shrineDraft !== undefined) {
    const d = s.shrineDraft;
    if (
      s.mode !== 'shrine' ||
      !object(d) ||
      !object(d.offers) ||
      !object(d.committed) ||
      !object(d.choices) ||
      typeof d.revealed !== 'boolean'
    )
      return false;
    for (const p of [1, 2]) {
      const offers = d.offers[p],
        choice = d.choices[p];
      if (
        !list(offers, 3) ||
        offers.length !== 3 ||
        !offers.every((k) => SHRINE_POOL.includes(k)) ||
        new Set(offers).size !== 3 ||
        typeof d.committed[p] !== 'boolean'
      )
        return false;
      if (
        d.committed[p] !== !!choice ||
        (choice &&
          (!object(choice) ||
            !offers.includes(choice.kind) ||
            (choice.kind === 's9' && !['odd', 'even'].includes(choice.parity))))
      )
        return false;
    }
    if (d.revealed !== (d.committed[1] && d.committed[2])) return false;
    if (s.phase === 'shrine-draft' && d.revealed) return false;
    if (s.phase !== 'shrine-draft' && !d.revealed) return false;
  } else if (s.mode === 'shrine') return false;
  if (
    s.ply === 0 &&
    !(
      s.mode === 'shrine' &&
      ['shrine-draft', 'shrine-setup'].includes(s.phase) &&
      s.turns[1] === 0 &&
      s.turns[2] === 0
    )
  )
    return false;
  if (s.ply > 0 && ['shrine-draft', 'shrine-setup'].includes(s.phase)) return false;
  if (s.summonOffer !== undefined) {
    const o = s.summonOffer;
    if (
      !object(o) ||
      o.owner !== s.active ||
      o.count !== 2 ||
      !list(o.groups, 4) ||
      o.groups.length < 3
    )
      return false;
    for (const group of o.groups)
      if (
        !list(group, 8) ||
        !group.length ||
        !group.every((c) => validCard(c, ids, s.mode === 'shrine')) ||
        (group.length > 1 && !group.every((c) => c.kind === 'u25' && c.group === group[0].group))
      )
        return false;
  }
  if (s.clockFrames !== undefined) {
    if (!object(s.clockFrames)) return false;
    for (const p of [1, 2]) {
      if (!object(s.clockFrames[p])) return false;
      for (const k of ['current', 'previous']) {
        const f = s.clockFrames[p][k];
        if (f === undefined) continue;
        if (
          !object(f) ||
          !int(f.ply, 0, s.ply) ||
          !object(f.turns) ||
          ![1, 2].every((p) => int(f.turns[p])) ||
          !list(f.units, 920) ||
          !f.units.every((u) => validUnit(u) && !isLandmark(u)) ||
          new Set(f.units.map((u) => u.id)).size !== f.units.length
        )
          return false;
      }
    }
  }
  // 随身神龛牌跨死亡和强夺仍保留身份，同一卡牌只能存在于一处。
  for (const u of [...s.units, ...(s.landmarks ?? [])])
    for (const id of Object.values(u.equipmentIds ?? {}) as string[]) {
      if (ids.has(id)) return false;
      ids.add(id);
    }
  return true;
}
/**
 * 存档信任边界：递归检查字段、占位、身份唯一性和嵌套快照的容量限制。
 * 只判断当前数据是否可接收，不重开回合、不修复随机状态，也不补算部署区域。
 */
export function validState(s: unknown): s is GameState {
  if (
    !object(s) ||
    s.version !== 2 ||
    !player(s.active) ||
    !int(s.ply, 0) ||
    !int(s.seed, 1, 4294967295) ||
    !int(s.rng, 1, 4294967295) ||
    !int(s.serial, 1)
  )
    return false;
  if (
    !['synthesis', 'summon', 'play', 'shrine-draft', 'shrine-setup'].includes(s.phase) ||
    !int(s.summonSlots, -1, 1000) ||
    (s.winner !== undefined && !player(s.winner) && s.winner !== 'draw')
  )
    return false;
  if (
    ![s.turns, s.bases, s.baseEffects, s.heads, s.hands, s.bonus, s.deployRows].every(object) ||
    !list(s.units, 920) ||
    !list(s.pending, 2000)
  )
    return false;
  const ids = new Set<string>(),
    occupied = new Map<string, Unit[]>();
  for (const raw of s.units) {
    if (!validUnit(raw) || isLandmark(raw) || ids.has(raw.id)) return false;
    const u = raw;
    ids.add(u.id);
    for (const p of cells(u)) {
      if (!inside(p)) return false;
      const old = occupied.get(key(p)) ?? [];
      const transit =
        hasTrait(u, 'u12') ||
        hasTrait(u, 'u12p') ||
        old.some((v) => hasTrait(v, 'u12') || hasTrait(v, 'u12p'));
      if (
        old.length &&
        !transit &&
        !(u.kind === 'u25' && u.size === 1 && old.every((v) => v.kind === 'u25' && v.size === 1))
      )
        return false;
      if (
        (equal(p, basePoint(1)) || equal(p, basePoint(2))) &&
        !(
          u.size === 1 &&
          ((hasTrait(u, 'u12') &&
            s.pending.some((r: any) => r.kind === 'bounce' && r.source?.id === u.id)) ||
            ((hasTrait(u, 'u12p') || hasTrait(u, 'u12')) && u.mode === 'move' && u.moves > 0))
        )
      )
        return false;
      occupied.set(key(p), [...old, u]);
    }
  }
  for (const p of [1, 2] as Player[]) {
    if (
      !int(s.turns[p]) ||
      !num(s.bases[p], 0, 300) ||
      !int(s.heads[p]) ||
      !int(s.bonus[p]) ||
      !effects(s.baseEffects[p]) ||
      !list(s.deployRows[p], 13) ||
      !s.deployRows[p].every((r: any) => int(r, 1, 13)) ||
      !list(s.hands[p], 2000)
    )
      return false;
    for (const c of s.hands[p]) if (!validCard(c, ids, s.mode === 'shrine')) return false;
  }
  if (!shrineFields(s, ids, occupied)) return false;
  if (
    !s.pending.every(
      (r: any) =>
        object(r) &&
        ['death-shot', 'reflect', 'bounce', 'hut-spawn', 'hit-pull'].includes(r.kind) &&
        (r.kind !== 'hit-pull' || text(r.targetId)) &&
        player(r.owner) &&
        validUnit(r.source, true) &&
        num(r.amount),
    )
  )
    return false;
  if (
    !list(s.deaths, 240) ||
    !s.deaths.every(
      (r: any) =>
        object(r) &&
        text(r.id) &&
        validKind(r.kind, true) &&
        player(r.owner) &&
        int(r.ply, 1) &&
        typeof r.revived === 'boolean',
    )
  )
    return false;
  if (
    !list(s.hazards) ||
    !s.hazards.every(
      (h: any) =>
        object(h) &&
        text(h.id) &&
        player(h.owner) &&
        ['row', 'column'].includes(h.axis) &&
        int(h.line, 1, h.axis === 'row' ? 13 : 9) &&
        int(h.due, 1),
    )
  )
    return false;
  if (
    !list(s.iceMarks) ||
    !s.iceMarks.every(
      (m: any) =>
        object(m) &&
        text(m.id) &&
        text(m.sourceId) &&
        player(m.owner) &&
        inside({ x: m.x, y: m.y }) &&
        int(m.due, 1),
    )
  )
    return false;
  if (
    !list(s.siphons) ||
    !s.siphons.every(
      (l: any) =>
        object(l) &&
        ['id', 'sourceId', 'fromId', 'toId'].every((k) => text(l[k])) &&
        player(l.owner),
    )
  )
    return false;
  if (
    !list(s.log, 180) ||
    !s.log.every((l: any) => typeof l === 'string' && l.length <= 2000) ||
    !list(s.events, 5000)
  )
    return false;
  return s.events.every(
    (e: any) =>
      object(e) &&
      text(e.id) &&
      [
        'spawn',
        'move',
        'attack',
        'damage',
        'heal',
        'death',
        'skill',
        'shield',
        'turn',
        'summon',
      ].includes(e.type) &&
      ['from', 'to'].every(
        (k) => e[k] === undefined || (object(e[k]) && num(e[k].x, 0, 10) && num(e[k].y, 0, 14)),
      ) &&
      (e.text === undefined || typeof e.text === 'string') &&
      (e.path === undefined ||
        (list(e.path, 200) && e.path.every((p: any) => object(p) && inside({ x: p.x, y: p.y })))),
  );
}
/**
 * 解析外部存档并验证现在、过去、未来及人类决策锚点，最后应用已确认兼容修正。
 * 格式或任一快照不合法时抛出中文错误；调用方应保留现有会话和原始存档。
 */
export function parseSession(text: string): Session {
  if (text.length > 24_000_000) throw new Error('存档超过24MB，请使用本游戏导出的存档。');
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('存档不是有效JSON。');
  }
  if (object(value) && (value.format === 'haojie2-session-v1' || value.present?.version === 1))
    throw new Error(
      '这是旧版“豪杰棋局”存档。浩劫2.0的操作规则不同，不自动迁移；原文件没有被修改。',
    );
  if (object(value) && value.format === 'haojie-record-v1') {
    if (value.match !== undefined && !validMatch(value.match))
      throw new Error('存档对局设置损坏。');
    return parseRecordedSave(value as unknown as import('./recording').RecordedSave);
  }
  if (
    !object(value) ||
    value.format !== 'haojie-session-v2' ||
    (value.match !== undefined && !validMatch(value.match)) ||
    (value.humanAnchor !== undefined && !validState(value.humanAnchor)) ||
    !validState(value.present) ||
    !list(value.past, LIMIT) ||
    !list(value.future, LIMIT) ||
    !value.past.every(validState) ||
    !value.future.every(validState)
  )
    throw new Error('存档结构不兼容或数据损坏，当前棋局未被替换。');
  if (value.record !== undefined) return parseRuntimeRecord(value as Session);
  return normalizeHornStorage(value as Session);
}
