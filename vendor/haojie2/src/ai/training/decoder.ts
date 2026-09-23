import type { Command, Player } from '../../engine/types';
import { ensure } from '../../engine/core/state';
import type { Observation } from '../types';
import { TrainingActionTree } from './action-tree';
import { encodeDecision, type EncodedDecision } from './encoding/decision';

export type PolicyEvaluator = (
  input: EncodedDecision,
  signal?: AbortSignal,
) => Promise<{ logits: number[]; value: number }>;
// 落点后选目标可能回溯整个117格棋盘；固定计数仍须允许完成这类稀疏选择域。
export const DEFAULT_DECODE_NODES = 256;
export interface DecodeOptions {
  maxNodes?: number;
  maxEvaluations?: number;
  signal?: AbortSignal;
}
export type PauseReason =
  | 'cancelled'
  | 'node-budget'
  | 'inference-budget'
  | 'depth-limit'
  | 'no-command'
  | 'inference-error'
  | 'invalid-output';
export interface DecodeStats {
  nodes: number;
  evaluations: number;
  forcedNodes: number;
  emptyBranches: number;
  backtracks: number;
  maxDepth: number;
  maxEntities: number;
  maxCandidates: number;
  treeMs: number;
  encodingMs: number;
  inferenceMs: number;
}
export interface DecodeResult {
  status: 'command' | 'paused';
  command?: Command;
  reason?: PauseReason;
  error?: string;
  value: number | null;
  leafStatus?: 'available' | 'uncertain';
  path: { stage: string; selected: number; key: string }[];
  stats: DecodeStats;
}

/**
 * 固定公开局面上的贪心分步解码，空分支按原评分顺序回溯；不是束搜索或MCTS。
 * 只把共享编码张量交给评估器，不访问权威随机数、不提交命令、不复用跨局面计划。
 * 单候选节点免推理；候选同分时沿用稳定下标。工作量预算只看计数，时间仅作诊断。
 * 取消、预算耗尽或推理异常均显式暂停；异步结果返回后再次检查取消，不自动选择end。
 */
export async function decodeCommand(
  observation: Observation,
  actor: Player,
  evaluate: PolicyEvaluator,
  options: DecodeOptions = {},
): Promise<DecodeResult> {
  const maxNodes = options.maxNodes ?? DEFAULT_DECODE_NODES,
    maxEvaluations = options.maxEvaluations ?? 32;
  ensure(Number.isSafeInteger(maxNodes) && maxNodes > 0, '节点预算必须是正整数。');
  ensure(Number.isSafeInteger(maxEvaluations) && maxEvaluations >= 0, '推理预算必须是非负整数。');
  const stats: DecodeStats = {
    nodes: 0,
    evaluations: 0,
    forcedNodes: 0,
    emptyBranches: 0,
    backtracks: 0,
    maxDepth: 0,
    maxEntities: 0,
    maxCandidates: 0,
    treeMs: 0,
    encodingMs: 0,
    inferenceMs: 0,
  };
  const result: DecodeResult = { status: 'paused', value: null, path: [], stats };
  const cancelled = () => {
    if (options.signal?.aborted) result.reason = 'cancelled';
    return result.reason !== undefined;
  };
  if (cancelled()) return result;
  const start = performance.now();
  const tree = new TrainingActionTree(observation, actor);
  stats.treeMs += performance.now() - start;
  const visit = async (cursor: number[]): Promise<boolean> => {
    if (cancelled()) return false;
    if (cursor.length > 256) {
      result.reason = 'depth-limit';
      return false;
    }
    if (stats.nodes >= maxNodes) {
      result.reason = 'node-budget';
      return false;
    }
    stats.nodes++;
    stats.maxDepth = Math.max(stats.maxDepth, cursor.length);
    const nodeStart = performance.now();
    const node = tree.node(cursor);
    stats.treeMs += performance.now() - nodeStart;
    stats.maxCandidates = Math.max(stats.maxCandidates, node.choices.length);
    if (!node.choices.length) {
      stats.emptyBranches++;
      return false;
    }
    const order = node.choices.map((_, index) => index);
    if (order.length === 1) stats.forcedNodes++;
    else {
      if (stats.evaluations >= maxEvaluations) {
        result.reason = 'inference-budget';
        return false;
      }
      const encodingStart = performance.now();
      const input = encodeDecision(observation, actor, node);
      stats.encodingMs += performance.now() - encodingStart;
      stats.maxEntities = Math.max(stats.maxEntities, input.entities.length);
      stats.evaluations++;
      const inferenceStart = performance.now();
      let output: Awaited<ReturnType<PolicyEvaluator>>;
      try {
        output = await evaluate(input, options.signal);
      } catch (error) {
        result.reason = options.signal?.aborted ? 'cancelled' : 'inference-error';
        result.error = error instanceof Error ? error.message : String(error);
        return false;
      } finally {
        stats.inferenceMs += performance.now() - inferenceStart;
      }
      if (cancelled()) return false;
      if (
        !Array.isArray(output?.logits) ||
        output.logits.length !== order.length ||
        !output.logits.every(Number.isFinite) ||
        !Number.isFinite(output.value) ||
        Math.abs(output.value) > 1
      ) {
        result.reason = 'invalid-output';
        return false;
      }
      if (!cursor.length) result.value = output.value;
      order.sort((a, b) => output.logits[b] - output.logits[a] || a - b);
    }
    for (const selected of order) {
      if (cancelled()) return false;
      const choice = node.choices[selected];
      result.path.push({ stage: node.stage, selected, key: choice.key });
      if (!choice.next) {
        result.command = choice.command;
        result.leafStatus = choice.status as 'available' | 'uncertain';
        return true;
      }
      if (await visit([...cursor, selected])) return true;
      // 暂停时保留最后尝试的前缀，供报告定位预算或推理失败的位置。
      if (result.reason) return false;
      result.path.pop();
      stats.backtracks++;
    }
    return false;
  };
  if (await visit([])) result.status = 'command';
  else result.reason ??= 'no-command';
  return result;
}
