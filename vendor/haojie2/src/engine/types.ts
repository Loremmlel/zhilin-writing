import type { EventFacts } from './core/event-facts';
import type { KeywordId } from './library/keywords';
/** 游戏状态完全由数据表示，不依赖渲染器、网络或墙钟。 */
export type Player = 1 | 2;
export type Kind =
  | number
  | '3p'
  | '17p'
  | 'grave'
  | 'wall'
  | `u${number}`
  | 'u12p'
  | 'firelord'
  | 'sage'
  | 'formless'
  | 'slayer'
  | 'citadel'
  | 'archmage'
  | `s${number}`
  | 'laoqian';
export type AttackDirection = 'up' | 'down' | 'left' | 'right';
export type Mode = 'none' | 'move' | 'attack' | 'skill' | 'charge';
export interface Point {
  x: number;
  y: number;
}
export interface Definition {
  id: Kind;
  name: string;
  glyph: string;
  role: string;
  tier: 'normal' | 'ultimate' | 'derived' | 'shrine';
  attack: number;
  health: number;
  range: number;
  actions: number;
  move: number;
  description: string;
  /** 同名规则词在本段说明中的明确含义；不往纯文本描述中嵌入 HTML。 */
  keywordReferences?: Readonly<Record<string, KeywordId>>;
  skill?: string;
  spell?: number;
  weapon?: number;
  size?: number;
  mage?: boolean;
  aura?: boolean;
  signedAttack?: boolean;
  landmark?: { rebuild: number; allowed?: Point[] };
}
export interface Effect {
  type:
    | 'attack'
    | 'immune'
    | 'execute'
    | 'convert'
    | 'mark'
    | 'freeze'
    | 'burn'
    | 'stun'
    | 'inner-fire';
  from: number;
  until: number;
  owner: Player;
  amount?: number;
  sourceId?: string;
  global?: boolean;
}
export interface Unit extends Point {
  id: string;
  kind: Kind;
  owner: Player;
  hp: number;
  maxHp: number;
  size: number;
  born: number;
  offset: number;
  deployedAt: number;
  chargedOnDeploy: boolean;
  mode: Mode;
  operations: number;
  shots: number;
  moves: number;
  attacked: string[];
  bonusAttacks: number;
  bonusSequence: boolean;
  weaponFirstUsed: boolean;
  charge: number;
  readyCharge: number;
  chargeType: 'move' | 'attack' | 'skill';
  lastCharge: number;
  upgrades: number;
  kills: number;
  attackBonus: number;
  rangeBonus: number;
  /** 旧版总保护标志；新版按来源消耗，不按受保护者合并。 */
  guardUsed: boolean;
  guardSourceIds?: string[];
  /** 改判次数跟随实际回合，不跟随冲锋号令的个人时钟。 */
  rerollUsedPly?: number;
  effects: Effect[];
  equipment: Kind[];
  silenced: boolean;
  freeUsed: number;
  onceUsed: boolean;
  /** 强夺获得的能力身份，不改变原有印刷身份。 */
  traits?: Kind[];
  abilityUsage?: Partial<Record<Kind, { once: boolean; free: number }>>;
  abilityCharges?: Partial<Record<Kind, AbilityCharge>>;
  equipmentIds?: Partial<Record<Kind, string>>;
  extraOperations?: number;
  bannerHp?: number;
  overMaxFromBanner?: boolean;
  bladeQualified?: boolean;
  receivedDamage?: { ply: number; amount: number }[];
  group?: string;
  expiresAt?: number;
  hookReadyAt?: number;
  hookExpiresAt?: number;
}
export interface Card {
  id: string;
  kind: Kind;
  drawnAt: number;
  expiresAt?: number;
  group?: string;
  rerolled?: boolean;
  summonedPly: number;
  summonPool?: 'normal' | 'ultimate';
  parity?: 'odd' | 'even';
}
export interface Reaction {
  kind: 'death-shot' | 'reflect' | 'bounce' | 'hut-spawn' | 'hit-pull';
  /** 固定为被命中棋子，后续操作不能另选受害者。 */
  targetId?: string;
  owner: Player;
  source: Unit;
  amount: number;
}
export interface GameEvent extends EventFacts {
  id: string;
  type:
    | 'spawn'
    | 'move'
    | 'attack'
    | 'damage'
    | 'heal'
    | 'death'
    | 'skill'
    | 'shield'
    | 'turn'
    | 'summon';
  path?: Point[];
  from?: Point;
  to?: Point;
  unitId?: string;
  owner?: Player;
  amount?: number;
  text?: string;
  ultimate?: boolean;
}
export interface DeathRecord {
  id: string;
  kind: Kind;
  owner: Player;
  ply: number;
  revived: boolean;
  group?: string;
}
export interface Hazard {
  id: string;
  owner: Player;
  sourceId?: string;
  axis: 'row' | 'column';
  line: number;
  due: number;
}
export interface Siphon {
  id: string;
  sourceId: string;
  owner: Player;
  fromId: string;
  toId: string;
}
export interface IceMark extends Point {
  id: string;
  sourceId: string;
  owner: Player;
  due: number;
}
export interface GamePosition {
  version: 2;
  serial: number;
  ply: number;
  active: Player;
  phase: 'shrine-draft' | 'shrine-setup' | 'synthesis' | 'summon' | 'play';
  mode?: 'shrine';
  landmarks?: Landmark[];
  auras?: Record<Player, Aura[]>;
  shrineDraft?: ShrineDraft;
  shrineSetupDone?: Player[];
  regularSummons?: number;
  summonOffer?: { owner: Player; groups: Card[][]; count: 2 };
  clockFrames?: Record<Player, { current?: ClockFrame; previous?: ClockFrame }>;
  summonSlots: number;
  turns: Record<Player, number>;
  bases: Record<Player, number>;
  baseEffects: Record<Player, Effect[]>;
  heads: Record<Player, number>;
  hands: Record<Player, Card[]>;
  bonus: Record<Player, number>;
  deployRows: Record<Player, number[]>;
  units: Unit[];
  pending: Reaction[];
  deaths: DeathRecord[];
  hazards: Hazard[];
  siphons: Siphon[];
  iceMarks: IceMark[];
  log: string[];
  events: GameEvent[];
  winner?: Player | 'draw';
}
/** 完整权威局面；公开局面绝不能虚构这些私有随机字段。 */
export interface GameState extends GamePosition {
  seed: number;
  rng: number;
}
/** 界面、存档回放及服务器适配共用的命令载荷类型。 */
export interface Command {
  type:
    | 'end'
    | 'summon'
    | 'begin'
    | 'reroll'
    | 'deploy'
    | 'move'
    | 'attack'
    | 'charge'
    | 'skill'
    | 'cast'
    | 'equip'
    | 'craft'
    | 'synthesize'
    | 'skip-synthesis'
    | 'react'
    | 'finish-mode'
    | 'choose-shrine'
    | 'finish-shrine-setup'
    | 'activate-aura'
    | 'extra-summon'
    | 'choose-summons'
    | 'clock'
    | 'shatter';
  player?: Player;
  shrineKind?: Kind;
  parity?: 'odd' | 'even';
  chosenKind?: Kind;
  offerIndices?: number[];
  ability?: Kind;
  recipeId?: string;
  materialIds?: string[];
  unitId?: string;
  cardId?: string;
  targetId?: string;
  secondId?: string;
  deathId?: string;
  x?: number;
  y?: number;
  column?: number;
  row?: number;
  mode?: string;
  ultimate?: boolean;
  /** 攻击路径最后一步方向；路径由引擎构造并验证。 */
  direction?: AttackDirection;
  /** 玩家选择的路径；战斗结算在任何修改前逐点验证。 */
  path?: Point[];
  charge?: boolean;
  cardIds?: string[];
  sacrificeIds?: string[];
}
export interface Stats {
  attack: number;
  range: number;
  actions: number;
  remaining: number;
  move: number;
  sleeping: boolean;
  operationLimit: number;
  operationsLeft: number;
  frozen: boolean;
  stunned: boolean;
  mode: Mode;
}
export interface Target extends Point {
  id: string;
  owner: Player;
  unit?: Unit;
}
export interface Source {
  base?: Player;
  owner?: Player;
  unit?: Unit;
  kind: 'attack' | 'spell' | 'skill' | 'status' | 'collision' | 'reflect' | 'sacrifice' | 'expire';
  path?: Point[];
  retaliated?: boolean;
  creditFriendly?: boolean;
  ignoreHead?: boolean;
  modified?: boolean;
}

export interface AbilityCharge {
  charge: number;
  readyCharge: number;
  chargeType: 'move' | 'attack' | 'skill';
  lastCharge: number;
}
export interface Landmark extends Unit {
  dormantSince?: number;
  rebuildTicks?: number;
}
export interface Aura {
  kind: Kind;
  parity?: 'odd' | 'even';
  usedPly?: number;
}
export interface ShrineDraft {
  offers: Record<Player, Kind[]>;
  committed: Record<Player, boolean>;
  choices: Partial<Record<Player, { kind: Kind; parity?: 'odd' | 'even' }>>;
  revealed: boolean;
}
export interface ClockFrame {
  ply: number;
  turns: Record<Player, number>;
  units: Unit[];
}
