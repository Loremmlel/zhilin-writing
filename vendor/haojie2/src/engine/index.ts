export * from './types';
export { KEYWORDS, KEYWORD_IDS, keywordDefinition, effectKeyword } from './library/keywords';
export type { KeywordId, KeywordDefinition, RuleReference } from './library/keywords';
export {
  CATALOG,
  LIBRARY,
  RULE_NOTES,
  definition,
  isStored,
  SUMMON_POOL,
  ULTIMATE_POOL,
} from './catalog';
export { createGame, createDemoGame, applyCommand, commandError, isLegal } from './commands/game';
export { createSession, dispatch, undo, redo, parseSession, validState } from './session/history';
export type { Session } from './session/history';
export { serializeSession, sessionSave } from './session/recording';
export type { RecordedSave } from './session/recording';
export {
  getStats,
  faction,
  activeEffect,
  effectClock,
  template,
  asTarget,
  RuleError,
  allegiance,
  has,
  now,
  passive,
  age,
  storageRemaining,
} from './core/state';
export {
  WIDTH,
  HEIGHT,
  ALL_CELLS,
  cells,
  occupant,
  occupants,
  targetAt,
  targets,
  distance,
  canPlace,
  deploymentRows,
  movementPath,
  attackPath,
  attackRoutes,
  selectableAttackRoutes,
  expansionAnchors,
  validAttackRoute,
  piercingTargets,
  pathDirection,
  other,
  basePoint,
} from './core/geometry';
export { unitActions, cardActions, reactionAction, actionError } from './commands/options';
export type { ActionSpec, SelectionStep } from './commands/options';

export {
  SYNTHESIS_RECIPES,
  availableSyntheses,
  synthesisMaterials,
  synthesisPlacement,
  synthesisDestinations,
} from './setup/synthesis';
export type { SynthesisRecipe } from './setup/synthesis';
export { COMBAT_RULES } from './catalog';
export { firelordStrike } from './commands/firelord';
export {
  attackAuraSources,
  piercing,
  healingAttack,
  counterChance,
  canCounterSpell,
} from './core/state';
export { hitPullDestination, hutSpawnPoints, canSkipReaction } from './commands/reactions';
export { availableGuardians, guardProtections } from './core/protection';
export { canRerollWith, rerollCommands, summonRerolls, summonPool } from './setup/summoning';

export { SHRINE_POOL, FLAG_CELLS } from './catalog';
export {
  allPieces,
  abilityKinds,
  isLandmark,
  isShrine,
  hasAura,
  aura,
  signedAttack,
  canDeployKind,
  isHookImmune,
} from './core/traits';
export {
  landmarkAt,
  liveLandmark,
  landmarkSquare,
  canChooseSummon,
  selectableSummons,
  commandSummonPool,
} from './setup/shrines';

export { inspectCommand, queryCommandError, canAttemptCommand } from './commands/game';
export type { CommandInspection } from './commands/game';
export { parseCommand, actorCommandError, applyPlayerCommand } from './online/authority';
export { getPlayerView, HAOJIE_RULESET, PLAYER_VIEW_VERSION } from './online/player-view';
export type { PlayerView } from './online/player-view';

export { canRebasePlayerCommand } from './online/authority';
