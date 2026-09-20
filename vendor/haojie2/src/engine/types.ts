import type { EventFacts } from './event-facts';
/** All game state is data. No renderer, network or wall clock is required. */
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
  /** Legacy aggregate flag; new protections are spent per source, not per recipient. */
  guardUsed: boolean;
  guardSourceIds?: string[];
  /** U13 allowance follows the real turn, not U17's independent unit clock. */
  rerollUsedPly?: number;
  effects: Effect[];
  equipment: Kind[];
  silenced: boolean;
  freeUsed: number;
  onceUsed: boolean;
  /** Skill identities acquired by ZF without changing its printed identity. */
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
  /** Fixed struck unit; a follow-up cannot select a different victim. */
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
/** Full authority. Public positions never manufacture these private random fields. */
export interface GameState extends GamePosition {
  seed: number;
  rng: number;
}
/** Typed command payload shared by UI, saved replays and future server adapters. */
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
  /** Direction of the final attack-path step; the engine constructs and validates the route. */
  direction?: AttackDirection;
  /** A player-selected route. Combat validates every point before any mutation. */
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
