import { CATALOG } from '../../../engine/catalog';
import { ensure } from '../../../engine/core/state';
import type { Command, Kind } from '../../../engine/types';

/** 编码语义变化必须更换版本；词表随数据文件保存并核对，不能静默重排旧模型输入。 */
export const ENCODING = 'haojie-entities-factorized-v1';
export const KIND_VOCAB = CATALOG.map((d) => d.id);
export const ROLES = [
  'base',
  'unit',
  'landmark',
  'card',
  'death',
  'effect',
  'equipment',
  'ability',
  'attacked',
  'guard',
  'received',
  'hazard',
  'siphon',
  'ice',
  'reaction',
  'snapshot',
  'frame',
  'aura',
  'draft-offer',
  'draft-choice',
  'summon-offer',
  'prefix',
  'argument',
  'path',
] as const;
export type EntityRole = (typeof ROLES)[number];
export const COMMANDS: Command['type'][] = [
  'end',
  'summon',
  'begin',
  'reroll',
  'deploy',
  'move',
  'attack',
  'charge',
  'skill',
  'cast',
  'equip',
  'craft',
  'synthesize',
  'skip-synthesis',
  'react',
  'finish-mode',
  'choose-shrine',
  'finish-shrine-setup',
  'activate-aura',
  'extra-summon',
  'choose-summons',
  'clock',
  'shatter',
];
export const MODES = [
  'none',
  'move',
  'attack',
  'skill',
  'damage',
  'heal',
  'summon',
  'single',
  'double',
  'row',
  'column',
  'pull',
  'normal',
];
export const PHASES = ['shrine-draft', 'shrine-setup', 'synthesis', 'summon', 'play'];
export const EFFECTS = [
  'attack',
  'immune',
  'execute',
  'convert',
  'mark',
  'freeze',
  'burn',
  'stun',
  'inner-fire',
];
export const REACTIONS = ['death-shot', 'reflect', 'bounce', 'hut-spawn', 'hit-pull'];
export const DIRECTIONS = ['up', 'down', 'left', 'right'] as const;
export const UNIT_FIELDS = [
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
  'expiresAt',
  'hookReadyAt',
  'hookExpiresAt',
  'dormantSince',
  'rebuildTicks',
] as const;

export function kindIndex(kind: Kind | undefined): number {
  if (kind === undefined) return 0;
  const index = KIND_VOCAB.indexOf(kind);
  ensure(index >= 0 && index < 128, `编码词表不支持棋子 ${String(kind)}，请升级编码版本。`);
  return index + 1;
}

export function kindFromKey(key: string): Kind {
  const kind = KIND_VOCAB.find((k) => String(k) === key);
  ensure(kind !== undefined, `未知能力/装备词表键 ${key}。`);
  return kind;
}

export function category(
  value: string | undefined,
  vocabulary: readonly string[],
): number | undefined {
  if (value === undefined) return undefined;
  const index = vocabulary.indexOf(value);
  ensure(index >= 0, `编码词表不支持 ${value}。`);
  return index + 1;
}

export function knownKeys(value: object, allowed: readonly string[], label: string): void {
  ensure(value && typeof value === 'object' && !Array.isArray(value), `${label}必须是对象。`);
  for (const key of Object.keys(value))
    ensure(allowed.includes(key), `${label}含未编码字段 ${key}。`);
}

/** 有限数值使用同一不截断缩放；四个13位存在掩码区分缺失、零与false。 */
export function numeric(value: number | boolean): number {
  if (typeof value === 'boolean') return Number(value);
  ensure(typeof value === 'number' && Number.isFinite(value), '编码数值必须有限。');
  return (Math.sign(value) * Math.log1p(Math.abs(value))) / 8;
}

export function valuesInto(row: number[], values: (number | boolean | undefined)[]): void {
  ensure(values.length <= 52, '实体字段超过52项，请升级编码结构，禁止截断。');
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (value === undefined) continue;
    row[8 + i] = numeric(value);
    row[60 + Math.floor(i / 13)] += 2 ** (i % 13) / 8191;
  }
}

export const ENCODING_SCHEMA = {
  encoding: ENCODING,
  entity_features: 64,
  global_features: 32,
  action_features: 64,
  kind_count: 256,
  kinds: KIND_VOCAB,
  roles: ROLES,
  commands: COMMANDS,
  modes: MODES,
  phases: PHASES,
  effects: EFFECTS,
  reactions: REACTIONS,
  unit_fields: UNIT_FIELDS,
};
