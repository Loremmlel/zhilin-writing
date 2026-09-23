import {
  actionError,
  cardActions,
  reactionAction,
  unitActions,
  type ActionSpec,
} from '../../engine/commands/options';
import { inspectCommand } from '../../engine/commands/game';
import { actorCommandError, parseCommand } from '../../engine/online/authority';
import {
  ALL_CELLS,
  targets,
  expansionAnchors,
  selectableAttackRoutes,
} from '../../engine/core/geometry';
import { allPieces } from '../../engine/core/traits';
import { ensure } from '../../engine/core/state';
import { definition } from '../../engine/catalog';
import {
  availableSyntheses,
  SYNTHESIS_RECIPES,
  synthesisDestinations,
} from '../../engine/setup/synthesis';
import { canChooseSummon, commandSummonPool, selectableSummons } from '../../engine/setup/shrines';
import type { Command, GamePosition, Player } from '../../engine/types';
import type { Observation } from '../types';

/** 仅接受策略观察；即使 JS 绕过 TS 类型也拒绝夹带正式随机状态/历史。查询不修改嵌套对象。 */
export function trainingPosition(observation: Observation): GamePosition {
  for (const key of ['seed', 'rng', 'log', 'events', 'past', 'future', 'present'])
    ensure(!Object.hasOwn(observation, key), `训练观察禁止携带 ${key}。`);
  return { ...observation, log: [], events: [] };
}

/** available/uncertain 都只是公开可尝试提示；uncertain 停在随机边界，绝不偷看实局抽牌。 */
export function inspectTrainingCommand(observation: Observation, actor: Player, input: unknown) {
  const s = trainingPosition(observation);
  const command = parseCommand(input);
  const error = actorCommandError(s, actor, command);
  return error
    ? { status: 'invalid' as const, message: error }
    : inspectCommand(s, command.type === 'choose-shrine' ? { ...command, player: actor } : command);
}

export interface TrainingAction extends ActionSpec {
  materialIds?: string[];
  materialCount?: number;
  chosenKinds?: ReturnType<typeof selectableSummons>;
}

/**
 * 未经策略评分裁剪的分解动作空间，复用引擎 ActionSpec、配方与来源池。
 * targets/points 是参数域，不是完整合法掩码；多参数动作须组合后公开预检并由实局裁决。
 * 路径保留为逐格序列，材料保留完整 ID 集，不把旧 AI 的有界候选当成全部动作。
 */
export function trainingActionSpace(observation: Observation, actor: Player) {
  const s = trainingPosition(observation);
  const actions: TrainingAction[] = [];
  const add = (a: TrainingAction) => {
    if (actorCommandError(s, actor, a.command) || (!a.materialCount && actionError(s, a))) return;
    const pool = commandSummonPool(s, a.command);
    actions.push({
      ...a,
      ...(pool && canChooseSummon(s, actor)
        ? { chosenKinds: selectableSummons(pool === 'ultimate') }
        : {}),
    });
  };
  const simple = (command: Command) =>
    add({ id: command.type, label: command.type, icon: '', command, steps: [] });
  if (!s.winner) {
    if (s.pending.length) {
      const action = reactionAction(s);
      if (action) add(action);
      simple({ type: 'react' });
    } else if (s.phase === 'shrine-draft') {
      for (const shrineKind of s.shrineDraft?.offers[actor] ?? [])
        for (const parity of shrineKind === 's9' ? (['odd', 'even'] as const) : [undefined])
          simple({
            type: 'choose-shrine',
            player: actor,
            shrineKind,
            ...(parity ? { parity } : {}),
          });
    } else {
      if (s.summonOffer) {
        for (let i = 0; i < s.summonOffer.groups.length; i++)
          for (let j = i + 1; j < s.summonOffer.groups.length; j++)
            simple({ type: 'choose-summons', offerIndices: [i, j] });
      } else {
        for (const type of ['begin', 'end', 'skip-synthesis', 'finish-shrine-setup'] as const)
          simple({ type });
        for (const type of ['summon', 'extra-summon'] as const)
          for (const ultimate of [false, true]) simple({ type, ultimate });
        for (const piece of allPieces(s))
          if (piece.owner === actor) for (const a of unitActions(s, piece)) add(a);
        if (actor === s.active) {
          for (const card of s.hands[actor]) for (const a of cardActions(s, card)) add(a);
          add({
            id: 'clock',
            label: '时钟',
            icon: '',
            command: { type: 'clock' },
            steps: [{ kind: 'target', label: '选择回溯目标', relation: 'any', unitOnly: true }],
          });
          if (s.phase === 'synthesis')
            for (const { recipe, ids } of availableSyntheses(s))
              add({
                id: `synthesize:${recipe.id}`,
                label: definition(recipe.result).name,
                icon: '',
                command: { type: 'synthesize', recipeId: recipe.id },
                materialIds: ids,
                materialCount: 3,
                steps: definition(recipe.result).aura
                  ? []
                  : [{ kind: 'point', label: '选择合成落点' }],
              });
        }
      }
    }
  }
  return {
    representation: 'factorized-unpruned' as const,
    validation: 'public-precheck' as const,
    actions,
    targetIds: targets(s).map((t) => t.id),
    points: ALL_CELLS.map((p) => ({ ...p })),
    directions: ['up', 'down', 'left', 'right'] as const,
    deathIds: s.deaths.map((d) => d.id),
  };
}

/** 多参数动作只查询共享几何，不在训练层复写占位、路径或合成规则。 */
export function trainingGeometry(observation: Observation, input: unknown) {
  const s = trainingPosition(observation);
  const c = parseCommand(input);
  if (c.type === 'synthesize') {
    const recipe = SYNTHESIS_RECIPES.find((r) => r.id === c.recipeId);
    ensure(recipe, '请选择有效配方。');
    return { points: synthesisDestinations(s, recipe, c.materialIds ?? []).map((p) => ({ ...p })) };
  }
  const pieces = allPieces(s);
  if (c.type === 'skill') {
    const target = pieces.find((u) => u.id === c.targetId);
    ensure(target, '请选择巨大化目标。');
    return { points: expansionAnchors(s, target) };
  }
  ensure(c.type === 'attack', '几何查询支持 attack、skill（巨大化）或 synthesize。');
  const unit = pieces.find((u) => u.id === c.unitId);
  const target = targets(s).find((t) => t.id === c.targetId);
  ensure(unit && target, '请选择攻击者和目标。');
  return { routes: structuredClone(selectableAttackRoutes(s, unit, target)) };
}
