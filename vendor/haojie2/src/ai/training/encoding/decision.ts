import { HEIGHT, WIDTH } from '../../../engine/core/geometry';
import { ensure } from '../../../engine/core/state';
import { SYNTHESIS_RECIPES } from '../../../engine/setup/synthesis';
import type { Player } from '../../../engine/types';
import type { Observation } from '../../types';
import type { ActionNode } from '../action-tree';
import { COMMANDS, DIRECTIONS, kindIndex, MODES } from './schema';
import { encodePosition } from './state';

export const DECISION_STAGES = [
  'action',
  'material',
  'chosen',
  'target',
  'point',
  'death',
  'row',
  'column',
  'direction',
  'path',
];
export interface EncodedDecision {
  entities: number[][];
  kinds: number[];
  entity_mask: boolean[];
  globals: number[];
  candidates: number[][];
  sources: number[];
  targets: number[];
  candidate_mask: boolean[];
}

/** 浏览器、数据准备与网络服务共用同一输入编码；不接受教师标签作为特征。 */
export function encodeDecision(
  observation: Observation,
  viewer: Player,
  node: ActionNode,
): EncodedDecision {
  ensure(node.choices.length > 0, '空动作分支须回溯，不能伪造合法候选。');
  const state = encodePosition(observation, viewer, node.prefix);
  const index = (id?: string) => {
    if (id === undefined) return -1;
    const result = state.indices.get(id);
    ensure(result !== undefined, `动作引用缺失的公开实体 ${id}。`);
    return result;
  };
  const sources: number[] = [],
    targetIndices: number[] = [];
  const candidates = node.choices.map((choice) => {
    const c = choice.command;
    const row = Array<number>(64).fill(0);
    row[COMMANDS.indexOf(c.type)] = 1;
    if (c.mode !== undefined) {
      const mode = MODES.indexOf(c.mode);
      ensure(mode >= 0, `候选模式未编码：${c.mode}。`);
      row[23 + mode] = 1;
    }
    row[36] = (c.x ?? 0) / WIDTH;
    row[37] = (c.y ?? 0) / HEIGHT;
    row[38] = (c.row ?? 0) / HEIGHT;
    row[39] = (c.column ?? 0) / WIDTH;
    row[40] = c.ultimate === undefined ? -1 : Number(c.ultimate);
    row[41] = c.charge === undefined ? -1 : Number(c.charge);
    row[42] = c.direction === undefined ? 0 : (DIRECTIONS.indexOf(c.direction) + 1) / 4;
    row[43] = kindIndex(c.ability) / 128;
    row[44] = kindIndex(c.chosenKind) / 128;
    row[45] = kindIndex(c.shrineKind) / 128;
    row[46] =
      c.recipeId === undefined
        ? 0
        : (SYNTHESIS_RECIPES.findIndex((r) => r.id === c.recipeId) + 1) / 8;
    row[47] = c.parity === undefined ? 0 : c.parity === 'odd' ? 1 : -1;
    row[48] = (DECISION_STAGES.indexOf(node.stage) + 1) / 16;
    row[49] = Number(choice.status !== 'parameter');
    row[50] = Number(choice.status === 'uncertain');
    row[51] = c.offerIndices?.[0] === undefined ? -1 : c.offerIndices[0] / 16;
    row[52] = c.offerIndices?.[1] === undefined ? -1 : c.offerIndices[1] / 16;
    row[53] = (c.materialIds?.length ?? 0) / 3;
    row[54] = (c.sacrificeIds?.length ?? 0) / 2;
    row[55] = (c.path?.length ?? 0) / 117;
    row[56] = state.reference(c.secondId) / 256;
    row[57] = state.reference(c.deathId) / 256;
    row[58] = Number(choice.key === 'commit-path');
    row[59] = c.player === undefined ? 0 : c.player === viewer ? 1 : -1;
    const point = c.path?.at(-1);
    row[60] = (point?.x ?? 0) / WIDTH;
    row[61] = (point?.y ?? 0) / HEIGHT;
    sources.push(
      index(
        c.unitId ??
          c.cardId ??
          (c.type === 'react' ? observation.pending[0]?.source.id : undefined),
      ),
    );
    targetIndices.push(index(choice.subject ?? c.targetId ?? c.deathId));
    return row;
  });
  return {
    entities: state.entities,
    kinds: state.kinds,
    globals: state.globals,
    entity_mask: state.entities.map(() => true),
    candidates,
    sources,
    targets: targetIndices,
    candidate_mask: candidates.map(() => true),
  };
}
