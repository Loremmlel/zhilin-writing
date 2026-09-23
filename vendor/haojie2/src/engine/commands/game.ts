import { emptyFor } from './movement';
import { attackPath, piercingTargets, validAttackRoute } from '../core/geometry';
import {
  activateAura,
  captureClockFrame,
  chooseShrine,
  validateShrineChoice,
  chooseSummons,
  clockRestore,
  extraSummon,
  initializeShrines,
  shatter,
  summon,
  syncBanners,
} from '../setup/shrines';
import { allPieces, canDeployKind, hasTrait } from '../core/traits';
import { withRandomSource, type RandomSource } from '../core/random';
import { synthesize } from '../setup/synthesis';
import { normalizeLegacyGuards } from '../core/protection';
import { definition, isStored } from '../catalog';
import { chargeAction, craft, equip, reroll, useSkill, cast } from './abilities';
import { findTarget, performAttack, pruneSiphons, resolution } from './combat';
import { canPlace, refreshDeployment, cells, equal } from '../core/geometry';
import { beginTurn, endTurn, switchTurn } from './lifecycle';
import { finishMode, moveUnit, react } from './movement';
import {
  actor,
  hasWeapon,
  piercing,
  addUnit,
  chooseMode,
  draw,
  emit,
  ensure,
  faction,
  finishOperation,
  getStats,
  point,
  RuleError,
  template,
} from '../core/state';
import type { Command, GamePosition, GameState, Kind, Player } from '../types';
export function createGame(seed = 20260907, mode: 'classic' | 'shrine' = 'classic'): GameState {
  ensure(Number.isSafeInteger(seed), '种子须为整数。');
  const normalized = seed >>> 0 || 2654435769;
  const s: GameState = {
    version: 2,
    seed: normalized,
    rng: normalized,
    serial: 1,
    ply: 1,
    active: 1,
    phase: 'summon',
    summonSlots: 2,
    turns: { 1: 0, 2: 0 },
    bases: { 1: 300, 2: 300 },
    baseEffects: { 1: [], 2: [] },
    heads: { 1: 0, 2: 0 },
    hands: { 1: [], 2: [] },
    bonus: { 1: 0, 2: 0 },
    deployRows: { 1: [1, 2, 3, 4, 5, 6, 7, 8], 2: [6, 7, 8, 9, 10, 11, 12, 13] },
    units: [],
    pending: [],
    deaths: [],
    hazards: [],
    siphons: [],
    iceMarks: [],
    log: [],
    events: [],
  };
  if (mode === 'shrine') initializeShrines(s);
  else beginTurn(s, resolution());
  return s;
}
/**
 * 在副本上执行一次完整命令，包括同步触发的反应和回合切换。
 * 任意校验失败直接抛出 RuleError；原局面的卡牌、人头和随机状态保持不变。
 * preview 仅供预检阻止未知随机结果，不能将预检副本作为权威局面提交。
 */
function transition<S extends GamePosition>(
  previous: S,
  c: Command,
  randomSource?: RandomSource,
  preview = false,
): S {
  ensure(previous.version === 2, '此命令只接受浩劫2.0局面；旧版对局不会被静默迁移。');
  ensure(!previous.winner, '对局已经结束，可悔棋或开新局。');
  ensure(!previous.pending.length || c.type === 'react', '请先处理当前待结算效果。');
  ensure(previous.summonSlots !== -1 || c.type === 'react', '当前正在结算回合结束效果。');
  const transit = previous.units.find(
    (u) =>
      (hasTrait(u, 'u12p') || hasTrait(u, 'u12')) && u.mode === 'move' && !emptyFor(previous, u),
  );
  ensure(
    !transit || c.type === 'react' || (c.type === 'move' && c.unitId === transit.id),
    '冲撞移动正在经过其他占位，必须先完成弹出或回到空地。',
  );
  const s = structuredClone(previous);
  normalizeLegacyGuards(s);
  s.events = [];
  return withRandomSource(s, randomSource, () => {
    const ctx = resolution();
    const giant =
      c.type === 'skill' &&
      (c.ability ?? allPieces(s).find((u) => u.id === c.unitId)?.kind) === 'u7';
    if (s.phase === 'shrine-draft') ensure(c.type === 'choose-shrine', '请先秘密选择神龛。');
    if (s.phase === 'shrine-setup')
      ensure(
        ['deploy', 'equip', 'activate-aura', 'finish-shrine-setup'].includes(c.type),
        '第0回合仅能部署、装备、启用或储存神龛。',
      );
    if (s.summonOffer) ensure(c.type === 'choose-summons', '请先从候选召唤中选出两个结果。');
    if (s.phase === 'synthesis')
      ensure(
        giant || ['synthesize', 'skip-synthesis', 'craft', 'react'].includes(c.type),
        '请先选择合成，或跳过合成进入召唤。',
      );
    if (
      ![
        'choose-shrine',
        'finish-shrine-setup',
        'activate-aura',
        'extra-summon',
        'choose-summons',
        'summon',
        'begin',
        'reroll',
        'react',
        'synthesize',
        'skip-synthesis',
        'craft',
      ].includes(c.type)
    )
      ensure(
        s.phase === 'play' || s.phase === 'shrine-setup' || giant,
        '先完成回合开始的召唤选择，再进入行动阶段。',
      );
    switch (c.type) {
      case 'synthesize':
        synthesize(s, c);
        break;
      case 'skip-synthesis':
        ensure(s.phase === 'synthesis', '当前不是合成窗口。');
        s.phase = 'summon';
        emit(s, { type: 'turn', owner: s.active, text: '进入召唤阶段' });
        break;
      case 'choose-shrine':
        if (preview) {
          validateShrineChoice(s, c);
          break;
        }
        chooseShrine(s, c);
        break;
      case 'finish-shrine-setup':
        ensure(s.phase === 'shrine-setup', '当前不是神龛入场阶段。');
        (s.shrineSetupDone ??= []).push(s.active);
        if (s.active === 1) s.active = 2;
        else {
          s.active = 1;
          s.ply = 1;
          beginTurn(s, ctx);
        }
        break;
      case 'activate-aura':
        ensure(
          s.phase === 'play' || s.phase === 'shrine-setup',
          '请在行动或开局入场阶段启用光环。',
        );
        activateAura(s, c);
        break;
      case 'choose-summons':
        chooseSummons(s, c);
        break;
      case 'extra-summon':
        extraSummon(s, c);
        break;
      case 'clock':
        clockRestore(s, c, ctx);
        break;
      case 'shatter':
        shatter(s, c, ctx);
        break;
      case 'summon':
        summon(s, c);
        break;
      case 'begin':
        ensure(s.phase === 'summon' && s.summonSlots === 0, '请先完成所有召唤。');
        s.phase = 'play';
        emit(s, { type: 'turn', owner: s.active, text: '行动阶段' });
        break;
      case 'reroll':
        reroll(s, c);
        break;
      case 'end':
        endTurn(s, ctx);
        break;
      case 'react':
        react(s, c, ctx);
        if (!s.pending.length && s.summonSlots === -1 && s.bases[1] > 0 && s.bases[2] > 0)
          switchTurn(s, ctx);
        break;
      case 'deploy': {
        const card = s.hands[s.active].find((v) => v.id === c.cardId);
        ensure(card && canDeployKind(card.kind), '请选择待部署随从。');
        const to = point(c.x, c.y),
          ghost = template(card.kind, s.active, s.turns[s.active], to);
        ensure(canPlace(s, ghost, to, true), '非法部署：检查行权限、占位、基地与独行侠禁区。');
        addUnit(s, card.kind, s.active, to, card.group, !!c.charge);
        s.hands[s.active] = s.hands[s.active].filter((v) => v.id !== card.id);
        break;
      }
      case 'move':
        moveUnit(s, c, ctx);
        break;
      case 'attack': {
        const u = actor(s, c.unitId);
        chooseMode(s, u, 'attack');
        if (c.path)
          ensure(
            hasWeapon(u, 'u28') && validAttackRoute(s, u, c.path, getStats(s, u).range),
            '所选穿透路径不合法。',
          );
        const t = findTarget(
          s,
          c.targetId ?? (c.path ? piercingTargets(s, u, c.path).at(-1)?.target.id : undefined),
        );
        const hitIds =
          piercing(u) && c.mode !== 'heal'
            ? piercingTargets(
                s,
                u,
                c.path ?? attackPath(s, u, t, getStats(s, u).range, c.direction, true) ?? [],
              ).map((v) => v.target.id)
            : [];
        performAttack(s, u, t, ctx, { direction: c.direction, mode: c.mode, path: c.path });
        u.attacked.push(...new Set([t.id, ...hitIds]));
        u.shots++;
        if (u.shots >= getStats(s, u).actions) finishOperation(u);
        break;
      }
      case 'charge':
        chargeAction(s, c);
        break;
      case 'finish-mode':
        finishMode(s, c);
        break;
      case 'skill':
        useSkill(s, c, ctx);
        break;
      case 'cast':
        cast(s, c, ctx);
        break;
      case 'equip':
        equip(s, c);
        break;
      case 'craft':
        craft(s, c);
        break;
      default:
        throw new RuleError('无法识别的游戏命令。');
    }
    syncBanners(s);
    pruneSiphons(s);
    refreshDeployment(s, 1);
    refreshDeployment(s, 2);
    if (s.bases[1] <= 0 || s.bases[2] <= 0) {
      s.winner = s.bases[1] <= 0 && s.bases[2] <= 0 ? 'draw' : s.bases[1] <= 0 ? 2 : 1;
      s.pending = [];
      emit(
        s,
        { type: 'turn', text: '对局结束' },
        s.winner === 'draw' ? '双方基地失守，平局' : `${faction(s.winner)}获胜`,
      );
    }
    return s;
  });
}
function hasRandomState(s: GamePosition): s is GameState {
  return 'seed' in s && typeof s.seed === 'number' && 'rng' in s && typeof s.rng === 'number';
}
/**
 * 正式规则入口：输入必须带真实随机状态，成功返回新局面，失败不修改输入。
 * randomSource 只用于受控模拟，调用方不得将模拟结果当作正式对局提交。
 */
export function applyCommand(
  previous: GameState,
  c: Command,
  randomSource?: RandomSource,
): GameState {
  ensure(hasRandomState(previous), '权威结算需要完整随机状态；玩家视图不能代替GameState。');
  return transition(previous, c, randomSource);
}
const unresolvedRandom = Symbol('preview requires private randomness');
export type CommandInspection =
  | { status: 'available' | 'uncertain' }
  | { status: 'invalid'; message: string };
/** 共用的确定性预检：在请求随机值之前停止，不编造结果。不返回新局面；预检通过也不代表权威接受命令。 */
export function inspectCommand(s: GamePosition, c: Command): CommandInspection {
  try {
    transition(
      s,
      c,
      () => {
        throw unresolvedRandom;
      },
      true,
    );
    return { status: 'available' };
  } catch (error) {
    if (error === unresolvedRandom) return { status: 'uncertain' };
    if (error instanceof RuleError) return { status: 'invalid', message: error.message };
    throw error;
  }
}
/** 本地提示保留原有完整局面校验，公开提示绝不抽取随机值。 */
export function queryCommandError(s: GamePosition, c: Command): string | null {
  if (hasRandomState(s)) return commandError(s, c);
  const result = inspectCommand(s, c);
  return result.status === 'invalid' ? result.message : null;
}
export const canAttemptCommand = (s: GamePosition, c: Command) => queryCommandError(s, c) === null;
export function commandError(s: GameState, c: Command): string | null {
  try {
    applyCommand(s, c);
    return null;
  } catch (e) {
    if (e instanceof RuleError) return e.message;
    throw e;
  }
}
export const isLegal = (s: GameState, c: Command) => commandError(s, c) === null;
export function createDemoGame(): GameState {
  const s = createGame(424242);
  s.phase = 'play';
  s.summonSlots = 0;
  s.ply = 5;
  s.turns = { 1: 3, 2: 2 };
  s.heads = { 1: 6, 2: 4 };
  s.bases = { 1: 268, 2: 234 };
  const setup: [Kind, Player, number, number][] = [
    [9, 1, 3, 5],
    [26, 1, 6, 6],
    [2, 1, 2, 4],
    ['u6', 1, 7, 3],
    [24, 2, 6, 8],
    [20, 2, 3, 7],
    ['u20', 2, 7, 10],
    [5, 2, 2, 10],
    ['u25', 2, 8, 8],
    ['u25', 2, 8, 8],
  ];
  for (const [kind, owner, x, y] of setup) {
    const u = addUnit(s, kind, owner, { x, y }, kind === 'u25' ? 'demo-clones' : undefined);
    u.born = 0;
    if (kind === 'u6') {
      u.charge = u.readyCharge = 1;
      u.chargeType = 'skill';
    }
  }
  for (const kind of [1, 8, 18, 'u5', 'u9', 'u17', 'u28'] as Kind[]) {
    const d = definition(kind),
      limit = d.spell ?? d.weapon;
    s.hands[1].push({
      id: `demo-${kind}`,
      kind,
      drawnAt: 3,
      summonedPly: s.ply,
      ...(limit !== undefined && limit >= 0 ? { expiresAt: 3 + limit } : {}),
    });
  }
  s.log = ['5 · 浩劫2.0演示局：试试大法师装备寒冰法杖、杀手攻击，以及回合末人头兑换终极召唤。'];
  s.events = [];
  refreshDeployment(s, 1);
  return s;
}
