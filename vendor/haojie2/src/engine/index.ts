export * from './types';
export {
  CATALOG,
  LIBRARY,
  RULE_NOTES,
  definition,
  isStored,
  SUMMON_POOL,
  ULTIMATE_POOL,
} from './catalog';
export { createGame, createDemoGame, applyCommand, commandError, isLegal } from './game';
export { createSession, dispatch, undo, redo, parseSession, validState } from './history';
export type { Session } from './history';
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
} from './state';
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
} from './geometry';
export { unitActions, cardActions, reactionAction, actionError } from './options';
export type { ActionSpec, SelectionStep } from './options';

export {
  SYNTHESIS_RECIPES,
  availableSyntheses,
  synthesisMaterials,
  synthesisPlacement,
  synthesisDestinations,
} from './synthesis';
export type { SynthesisRecipe } from './synthesis';
export { COMBAT_RULES } from './catalog';
export { firelordStrike } from './firelord';
export { attackAuraSources, piercing, healingAttack, counterChance } from './state';
export { hitPullDestination, hutSpawnPoints, canSkipReaction } from './reactions';
export { availableGuardians, guardProtections } from './protection';
export { canRerollWith, rerollCommands, summonRerolls, summonPool } from './summoning';

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
} from './traits';
export {
  landmarkAt,
  liveLandmark,
  landmarkSquare,
  canChooseSummon,
  selectableSummons,
  commandSummonPool,
} from './shrines';

export { inspectCommand, queryCommandError, canAttemptCommand } from './game';
export type { CommandInspection } from './game';
export { parseCommand, actorCommandError, applyPlayerCommand } from './authority';
export { getPlayerView, HAOJIE_RULESET, PLAYER_VIEW_VERSION } from './player-view';
export type { PlayerView } from './player-view';

export { canRebasePlayerCommand } from './authority';
