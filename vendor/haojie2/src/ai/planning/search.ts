import { draftDecision } from './shrines';
import { deploymentRows } from '../../engine/core/geometry';
import type { Command, GameState, Player } from '../../engine/types';
import {
  iterateCandidateGroups,
  attackCandidates,
  deploymentCandidates,
  commandPriority,
  type CandidateGroup,
} from './candidates';
import { DIFFICULTIES } from '../difficulty';
import { analyzePayload } from '../evaluation/threats';
import { evaluate, explainEvaluation, materialValue } from '../evaluation/evaluate';
import { decisionOwner, hash, imagined } from '../observation';
import { createStateKeys } from '../simulation/state-key';
import { distribution as rawDistribution } from '../simulation/simulate';
import type { Outcome } from '../simulation/simulate';
import type { Decision, Difficulty, Observation, PlanStep, SearchLimits } from '../types';
interface Node {
  outcomes: Outcome[];
  score: number;
  path: PlanStep[];
  root: string;
  expandable: boolean;
  sampled?: boolean;
  replyTested?: boolean;
  endTested?: boolean;
}
interface Context {
  keys: ReturnType<typeof createStateKeys>;
  count: number;
  candidates: number;
  sampled: number;
  replies: number;
  depth: number;
  max: number;
  stopAt: number;
  deadline: number;
  side: Player;
  difficulty: Difficulty;
  cache: Map<string, number>;
  scenarioSeed: number;
}
// 候选之间共用随机场景以降低抽样噪声，绝不使用正式 PRNG。
function scenarioKey(
  ctx: Context,
  s: GameState,
  command: import('../../engine/types').Command,
  sample: number,
): string {
  const u = s.units.find((v) => v.id === command.unitId);
  return JSON.stringify([
    ctx.scenarioSeed,
    sample,
    s.ply,
    s.summonSlots,
    command.type,
    command.unitId,
    command.cardId,
    u?.shots,
    u?.moves,
    u?.operations,
    u?.freeUsed,
    ...(u?.rerollUsedPly === undefined ? [] : [u.rerollUsedPly]),
  ]);
}
const time = () => (typeof performance === 'undefined' ? Date.now() : performance.now());
function stopped(ctx: Context): boolean {
  return ctx.count >= ctx.stopAt || time() >= ctx.deadline;
}
function value(ctx: Context, s: GameState): number {
  const key = ctx.keys.positionKey(s);
  let v = ctx.cache.get(key);
  if (v === undefined) {
    v = evaluate(s, ctx.side);
    if (ctx.cache.size > 3000) ctx.cache.clear();
    ctx.cache.set(key, v);
  }
  return v;
}
function expectation(ctx: Context, out: Outcome[]): number {
  const scores = out.map((o) => value(ctx, o.state));
  const mean = out.reduce((v, o, i) => v + o.weight * scores[i], 0);
  // 小幅惩罚下行风险，但不替代随机结果的期望值。
  const risk = ctx.difficulty === 'hard' ? 0.06 : 0;
  return mean - risk * out.reduce((v, o, i) => v + o.weight * Math.max(0, mean - scores[i]), 0);
}
/** 每次 yield 都是取消与协作调度边界；Worker 和主线程回退运行相同代码。 */
function* expand(
  ctx: Context,
  s: GameState,
  path: PlanStep[],
  level: Difficulty = ctx.difficulty,
  lean = false,
  salt = 0,
): Generator<void, Node[]> {
  const settings = DIFFICULTIES[level],
    result: Node[] = [],
    seen = new Set<string>();
  const work: (CandidateGroup & { index: number; accepted: number })[] = [];
  for (const group of iterateCandidateGroups(s, level, lean)) {
    work.push({
      family: group.family,
      priority: group.priority,
      get commands() {
        return group.commands;
      },
      keep: lean || path.length ? 1 : group.keep,
      index: 0,
      accepted: 0,
    });
    yield;
  }
  // 回合推演使用窄策略，不在每条原子命令上重复完整根搜索。
  if (lean) {
    work.sort(
      (a, b) =>
        (b.priority ?? commandPriority(s, b.commands[0])) -
        (a.priority ?? commandPriority(s, a.commands[0])),
    );
    work.splice(3);
  }
  const localStart = ctx.count;
  const localLimit = lean ? Infinity : path.length ? 24 : Math.max(40, Math.floor(ctx.max * 0.16));
  let live = work.length;
  while (live > 0) {
    const passStart = result.length;
    live = 0;
    for (const group of work) {
      if (group.index >= group.commands.length || group.accepted >= group.keep) continue;
      live++;
      if (
        (stopped(ctx) || ctx.count - localStart >= localLimit) &&
        result.length &&
        !(s.phase === 'summon' && group.family === 'summon' && group.accepted < group.keep)
      )
        return result;
      const command = group.commands[group.index++],
        key = JSON.stringify(command);
      if (seen.has(key)) continue;
      seen.add(key);
      const d = distribution(
        ctx,
        s,
        command,
        lean ? 2 : command.type === 'summon' ? 64 : settings.chanceLimit,
        lean ? 1 : settings.chanceSamples,
        salt,
        lean ? scenarioKey(ctx, s, command, salt) : undefined,
      );
      ctx.count += d.attempts;
      if (d.sampled) ctx.sampled++;
      if (d.outcomes.length) {
        ctx.candidates++;
        group.accepted++;
        if (!lean) ctx.depth = Math.max(ctx.depth, path.length + 1);
        const nextPath = [...path, { before: ctx.keys.fingerprint(s), command }];
        const only = d.outcomes.length === 1 ? d.outcomes[0].state : null;
        result.push({
          outcomes: d.outcomes,
          sampled: d.sampled,
          score:
            expectation(ctx, d.outcomes) -
            nextPath.filter((p) => p.command.type === 'move').length * 0.2,
          path: nextPath,
          root: path.length ? JSON.stringify(path[0].command) : key,
          expandable:
            !!only &&
            !only.winner &&
            only.active === s.active &&
            only.phase === s.phase &&
            decisionOwner(only) === decisionOwner(s),
        });
      }
      yield;
    }
    if (!lean && !path.length && !stopped(ctx)) {
      result.push(...(yield* attackContinuations(ctx, result.slice(passStart), level)));
      result.push(...(yield* deploymentContinuations(ctx, s, result.slice(passStart))));
    }
  }
  return result;
}
/** 避免即时部署的物质收益挤掉“先移动开行、再落子”。只接续确定且无反应的移动，共用原预算；完整结果仍接受危险与对手回应评估。 */
function* deploymentContinuations(
  ctx: Context,
  before: GameState,
  roots: Node[],
): Generator<void, Node[]> {
  const added: Node[] = [];
  const rows = deploymentRows(before, before.active);
  for (const root of roots) {
    if (stopped(ctx)) break;
    if (
      root.path.at(-1)?.command.type !== 'move' ||
      !root.expandable ||
      root.sampled ||
      root.outcomes.length !== 1
    )
      continue;
    const state = root.outcomes[0].state;
    if (state.pending.length) continue;
    const gained = deploymentRows(state, state.active).filter((y) => !rows.includes(y));
    if (!gained.length) continue;
    for (const command of deploymentCandidates(state, gained).slice(0, 4)) {
      if (stopped(ctx)) break;
      const d = distribution(ctx, state, command, 1, 1);
      ctx.count += d.attempts;
      if (d.sampled) ctx.sampled++;
      if (d.outcomes.length) {
        ctx.candidates++;
        const next = d.outcomes.length === 1 ? d.outcomes[0].state : null;
        const path = [...root.path, { before: ctx.keys.fingerprint(state), command }];
        added.push({
          outcomes: d.outcomes,
          sampled: d.sampled,
          score: expectation(ctx, d.outcomes) - 0.2,
          root: root.root,
          path,
          expandable:
            !!next && !next.winner && !next.pending.length && next.active === state.active,
        });
        ctx.depth = Math.max(ctx.depth, path.length);
      }
      yield;
    }
  }
  return added;
}
/** 同时评估短小但完整的连射操作，避免因束深度到不了第六发而输给无收益移动。保留单发节点以允许穿插标记或治疗；遇未知随机或反应必须停止。 */
function* attackContinuations(
  ctx: Context,
  roots: Node[],
  level: Difficulty,
): Generator<void, Node[]> {
  const added: Node[] = [];
  for (const root of roots) {
    const first = root.path.at(-1)!.command;
    if (first.type !== 'attack' || !first.unitId || !root.expandable) continue;
    let current = root;
    for (let step = 0; step < 5 && !stopped(ctx); step++) {
      if (current.outcomes.length !== 1) break;
      const state = current.outcomes[0].state;
      if (state.pending.length || state.winner) break;
      let best: Node | undefined, focused: Node | undefined;
      const followups = attackCandidates(state, first.unitId);
      // 留下标记或耗尽攻击的射手可将同一目标交给友方；
      // 连招必须合法且确定，随机或反应边界仍会中断。
      if (state.units.some((u) => u.id === first.targetId) || first.targetId?.startsWith('base-'))
        for (const ally of state.units)
          if (ally.owner === state.active && ally.id !== first.unitId)
            followups.push(...attackCandidates(state, ally.id, first.targetId));
      const priorities = new Map(followups.map((c) => [c, commandPriority(state, c)]));
      followups.sort((a, b) => priorities.get(b)! - priorities.get(a)!);
      for (const command of followups.slice(0, level === 'hard' ? 6 : 3)) {
        if (stopped(ctx)) break;
        const d = distribution(
          ctx,
          state,
          command,
          DIFFICULTIES[level].chanceLimit,
          DIFFICULTIES[level].chanceSamples,
        );
        ctx.count += d.attempts;
        if (d.sampled) ctx.sampled++;
        if (d.outcomes.length) {
          ctx.candidates++;
          const single = d.outcomes.length === 1 ? d.outcomes[0].state : null;
          const node: Node = {
            outcomes: d.outcomes,
            sampled: current.sampled || d.sampled,
            score: expectation(ctx, d.outcomes),
            root: root.root,
            path: [...current.path, { before: ctx.keys.fingerprint(state), command }],
            expandable:
              !!single &&
              !single.winner &&
              single.active === state.active &&
              decisionOwner(single) === decisionOwner(state),
          };
          ctx.depth = Math.max(ctx.depth, node.path.length);
          if (command.targetId === first.targetId && (!focused || node.score > focused.score))
            focused = node;
          if (!best || node.score > best.score) best = node;
        }
        yield;
      }
      best = focused ?? best;
      if (!best) break;
      current = best;
      if (best.score > root.score + 0.01) added.push(best);
      if (!best.expandable) break;
    }
  }
  return added;
}
function bestDiverse(ctx: Context, nodes: Node[], width: number, seen: Set<string>): Node[] {
  const chosen: Node[] = [],
    roots = new Map<string, number>();
  for (const node of [...nodes].sort((a, b) => b.score - a.score)) {
    if (!node.expandable) continue;
    const state = node.outcomes[0].state,
      key = ctx.keys.positionKey(state);
    if (seen.has(key) || (roots.get(node.root) ?? 0) >= Math.max(2, Math.ceil(width / 3))) continue;
    roots.set(node.root, (roots.get(node.root) ?? 0) + 1);
    seen.add(key);
    chosen.push(node);
    if (chosen.length === width) break;
  }
  return chosen;
}
function selectForOwner(nodes: Node[], ctx: Context, owner: Player): Node | undefined {
  return nodes.sort((a, b) => (owner === ctx.side ? b.score - a.score : a.score - b.score))[0];
}
/** 在预算内合法推演完整回合；对手反应按对抗处理，不能假定合作。概率节点只能在观察到该次样本结果后调整策略。 */
function* rollout(
  ctx: Context,
  initial: GameState,
  owner: Player,
  scenario = 0,
  steps = 100,
): Generator<void, GameState> {
  let state = initial;
  for (let i = 0; i < steps && !state.winner; i++) {
    if (stopped(ctx)) break;
    if (state.active !== owner && !state.pending.length) break;
    const mover = decisionOwner(state),
      nodes = yield* expand(ctx, state, [], 'easy', true, scenario);
    const choice = selectForOwner(nodes, ctx, mover);
    if (!choice) break;
    // 不按评分挑选推演样本，结果选择独立固定。
    let draw = (hash(scenarioKey(ctx, state, choice.path[0].command, scenario)) + 0.5) / 4294967296;
    let selected = choice.outcomes.at(-1)!;
    for (const out of choice.outcomes) {
      draw -= out.weight;
      if (draw <= 0) {
        selected = out;
        break;
      }
    }
    state = selected.state;
  }
  return state;
}
/** 只比较已结算的回合结束局面；未决反应、未部署召唤和某条幸运分支都不算完整备选结果。 */
function* atTurnEnd(ctx: Context, s: GameState, node: Node): Generator<void, Node | null> {
  if (node.sampled) return null;
  const outcomes: Outcome[] = [];
  for (const out of node.outcomes) {
    if (out.state.winner) {
      outcomes.push(out);
      continue;
    }
    if (out.state.pending.length) return null;
    if (out.state.ply === s.ply + 1 && out.state.active !== s.active) {
      outcomes.push(out);
      continue;
    }
    if (out.state.ply !== s.ply || out.state.active !== s.active || stopped(ctx)) return null;
    const d = distribution(
      ctx,
      out.state,
      { type: 'end' },
      DIFFICULTIES[ctx.difficulty].chanceLimit,
    );
    ctx.count += d.attempts;
    if (d.sampled) ctx.sampled++;
    if (d.outcomes.length) ctx.candidates++;
    yield;
    if (
      d.sampled ||
      !d.outcomes.length ||
      d.outcomes.some(
        (o) =>
          !o.state.winner &&
          (o.state.pending.length || o.state.ply !== s.ply + 1 || o.state.active === s.active),
      )
    )
      return null;
    outcomes.push(...d.outcomes.map((o) => ({ ...o, weight: o.weight * out.weight })));
  }
  return {
    ...node,
    outcomes,
    score: expectation(ctx, outcomes),
    expandable: false,
    endTested: true,
  };
}
/** 结束前复查已探索的战术机会，不强迫移动。独立比较同一回合边界，不把分数混入对手回应表；只用有界精确分支，并共用原预算。 */
function* reconsiderEnd(
  ctx: Context,
  s: GameState,
  nodes: Node[],
): Generator<void, { choices: Node[]; checks: number }> {
  const end = nodes.find((n) => n.path.length === 1 && n.path[0].command.type === 'end');
  if (!end) return { choices: [], checks: 0 };
  const baseline = yield* atTurnEnd(ctx, s, end);
  if (!baseline) return { choices: [], checks: 0 };
  let best = baseline,
    checks = 0;
  const tactical = new Set<Command['type']>(['attack', 'skill', 'charge', 'cast', 'equip']);
  const seen = new Set<string>();
  const alternatives = nodes.filter(
    (n) =>
      tactical.has(n.path[0].command.type) &&
      // 抽样分支不能证明行动比等待更有利。
      !n.sampled &&
      n.outcomes.length &&
      n.path.every((step) => tactical.has(step.command.type)),
  );
  alternatives.sort(
    (a, b) =>
      commandPriority(s, b.path[0].command) - commandPriority(s, a.path[0].command) ||
      b.path.length - a.path.length,
  );
  for (const node of alternatives) {
    if (stopped(ctx)) break;
    const key = JSON.stringify(node.path.map((p) => p.command));
    if (seen.has(key)) continue;
    seen.add(key);
    const candidate = yield* atTurnEnd(ctx, s, node);
    checks++;
    if (candidate && candidate.score > best.score + 0.01) best = candidate;
  }
  return { choices: best === baseline ? [] : [best, baseline], checks };
}
/**
 * 在公开观察和显式预算内做束搜索，困难档额外比较完整成对的对手回应。
 * yield 让宿主及时取消或让出线程；返回计划只代表预测，执行前仍须校验指纹。
 * work 模式的选招由工作量决定；墙钟仅在显式 timed 模式中截断搜索。
 */
export function* search(
  observation: Observation,
  side: Player,
  difficulty: Difficulty,
  limits: Partial<SearchLimits> = {},
): Generator<void, Decision> {
  const cfg = DIFFICULTIES[difficulty],
    s = imagined(observation),
    max = Math.max(40, limits.simulations ?? cfg.nodes);
  const reserve = s.phase === 'play' && !s.pending.length ? Math.min(160, Math.floor(max / 5)) : 0;
  const searchMax = max - reserve;
  const keys = createStateKeys();
  const ctx: Context = {
    keys,
    count: 0,
    candidates: 0,
    sampled: 0,
    replies: 0,
    depth: 1,
    max,
    stopAt: searchMax,
    deadline:
      limits.mode === 'timed'
        ? time() + Math.max(10, limits.milliseconds ?? cfg.decisionMs)
        : Infinity,
    side,
    difficulty,
    cache: new Map(),
    scenarioSeed: hash(keys.positionKey(s)),
  };
  if (s.winner || decisionOwner(s) !== side)
    return {
      command: null,
      plan: [],
      stats: { simulations: 0, candidates: 0, depth: 0, replies: 0, sampled: 0, exhausted: false },
    };
  if (s.phase === 'shrine-draft') return draftDecision(s, side);
  const fullDeadline = ctx.deadline;
  if (difficulty === 'hard') {
    if (Number.isFinite(fullDeadline))
      ctx.deadline = time() + Math.max(10, (fullDeadline - time()) * 0.4);
    ctx.stopAt = Math.min(searchMax, Math.max(40, Math.floor(max * 0.4)));
  }
  const synthesisOnly = ['synthesis', 'shrine-setup'].includes(s.phase) && !s.pending.length;
  const roots = yield* expand(ctx, s, []);
  const bestByRoot = new Map<string, Node>();
  for (const n of roots)
    if (!bestByRoot.has(n.root) || n.score > bestByRoot.get(n.root)!.score)
      bestByRoot.set(n.root, n);
  // 为真实对手回应保留预算，不能全部花在己方动作上。
  ctx.stopAt =
    difficulty === 'hard'
      ? Math.min(searchMax, Math.max(ctx.count, Math.floor(max * 0.4)))
      : searchMax;
  const seen = new Set<string>();
  let beam = bestDiverse(ctx, roots, cfg.width, seen);
  for (
    let depth = 2;
    depth <= cfg.depth && !synthesisOnly && beam.length && !stopped(ctx);
    depth++
  ) {
    const children: Node[] = [];
    for (const parent of beam) {
      if (stopped(ctx)) break;
      const next = yield* expand(ctx, parent.outcomes[0].state, parent.path);
      for (const node of next) {
        const old = bestByRoot.get(node.root);
        if (!old || node.score > old.score + 0.01) bestByRoot.set(node.root, node);
      }
      children.push(...next);
    }

    beam = bestDiverse(ctx, children, cfg.width, seen);
  }
  let choices = [...bestByRoot.values()].sort((a, b) => b.score - a.score);
  // 结束回合不能进入最终候选时，收回其安全预算。
  const endCanWin = choices
    .slice(0, difficulty === 'hard' ? cfg.replyRoots : difficulty === 'easy' ? 3 : 1)
    .some((n) => n.path[0].command.type === 'end');
  ctx.stopAt = endCanWin ? searchMax : max;
  ctx.deadline = fullDeadline;
  let replyCandidates = 0,
    replySamples = 0;
  if (
    difficulty === 'hard' &&
    !synthesisOnly &&
    s.phase !== 'summon' &&
    choices.length > 1 &&
    !stopped(ctx)
  ) {
    const shortlist = choices.slice(0, cfg.replyRoots);
    const sums = shortlist.map(() => 0);
    // 只采用完整成对场景；即使后续场景耗尽预算，
    // 已完成的首轮仍然有效，不能混入半回合评分或数量不等的样本。
    for (let sample = 0; sample < 2 && !stopped(ctx); sample++) {
      const roundScores: number[] = [];
      const roundDeadline = ctx.deadline;
      for (let index = 0; index < shortlist.length; index++) {
        if (stopped(ctx)) break;
        const node = shortlist[index];
        let draw = (hash(ctx.keys.fingerprint(s) + ':reply:' + sample) + 0.5) / 4294967296;
        let state = node.outcomes.at(-1)!.state;
        for (const out of node.outcomes) {
          draw -= out.weight;
          if (draw <= 0) {
            state = out.state;
            break;
          }
        }
        if (node.outcomes.length > 1) ctx.sampled++;
        // 显式 timed 模式均分时间片；正常生产模式采用固定工作量预算。
        ctx.deadline = Math.min(
          roundDeadline,
          time() + (roundDeadline - time()) / (shortlist.length - index),
        );
        if (!state.winner && state.active === side)
          state = yield* rollout(ctx, state, side, sample);
        if (!state.winner && state.active !== side)
          state = yield* rollout(ctx, state, state.active, sample);
        ctx.deadline = roundDeadline;
        if (
          state.winner ||
          (state.active === side && state.ply >= s.ply + 2 && !state.pending.length)
        ) {
          ctx.replies++;
          roundScores.push(value(ctx, state));
        } else break;
      }
      if (roundScores.length !== shortlist.length) break;
      replySamples++;
      roundScores.forEach((score, index) => (sums[index] += score));
      choices = shortlist
        .map((node, index) => ({ ...node, score: sums[index] / replySamples, replyTested: true }))
        .sort((a, b) => b.score - a.score);
      replyCandidates = shortlist.length;
    }
  }
  let selected = choices[0];
  if (
    difficulty === 'easy' &&
    !synthesisOnly &&
    s.phase !== 'summon' &&
    selected &&
    Math.abs(selected.score) < 90000
  ) {
    const near = choices.filter((n) => selected!.score - n.score <= cfg.noise).slice(0, 3);
    selected = near[hash(ctx.keys.fingerprint(s)) % near.length];
  }
  // 缓存不能盲目执行后续结束回合；新决策再次提出结束时，
  // 即使束搜索和回应预算已用完，也要检查未兑现的战术收益。
  const searchExhausted = stopped(ctx);
  const nodeLimitReached = ctx.count >= ctx.stopAt;
  ctx.stopAt = max;
  let endTurnChecks = 0,
    endTurnImproved = false;
  if (selected?.path[0]?.command.type === 'end' && reserve && !stopped(ctx)) {
    const audit = yield* reconsiderEnd(ctx, s, roots);
    endTurnChecks = audit.checks;
    if (audit.choices.length) {
      choices = audit.choices;
      selected = choices[0];
      endTurnImproved = true;
      // 已完成回应仍记入 replies，但它们没有用于选择这次替换结果。
      replyCandidates = replySamples = 0;
    }
  }
  const plan = selected?.path ?? [];
  return {
    command: plan[0]?.command ?? null,
    plan,
    ...(limits.trace
      ? {
          trace: {
            initial: { ...explainEvaluation(s, side) },
            chosen: plan[0]?.command ?? null,
            alternatives: choices.slice(0, 12).map((node) => ({
              command: node.path[0].command,
              score: node.score,
              stage: node.endTested
                ? ('end-turn' as const)
                : node.replyTested
                  ? ('reply' as const)
                  : ('static' as const),
              line: node.path.map((step) => step.command),
              outcomes: node.outcomes.map((out) => ({
                probability: out.weight,
                score: value(ctx, out.state),
                bases: out.state.bases,
                terms: { ...explainEvaluation(out.state, side) },
                payloads: out.state.units.flatMap((u) =>
                  (['execute', 'convert'] as const)
                    .filter((type) => u.effects.some((e) => e.type === type))
                    .map((type) =>
                      analyzePayload(out.state, u, type, (v) => materialValue(out.state, v)),
                    ),
                ),
              })),
            })),
          },
        }
      : {}),
    stats: {
      simulations: ctx.count,
      candidates: ctx.candidates,
      depth: ctx.depth,
      replies: ctx.replies,
      sampled: ctx.sampled,
      exhausted: searchExhausted || stopped(ctx),
      mode: limits.mode ?? 'work',
      stopReason:
        nodeLimitReached || ctx.count >= max
          ? 'nodes'
          : time() >= ctx.deadline
            ? 'time'
            : 'complete',
      replyCandidates,
      replySamples,
      selectedDepth: plan.length,
      endTurnChecks,
      endTurnImproved,
    },
  };
}
/** 供 Node 测试与受控基准使用的同步入口，界面不能调用。 */
export function decide(
  observation: Observation,
  side: Player,
  difficulty: Difficulty,
  limits: Partial<SearchLimits> = {},
): Decision {
  const iterator = search(observation, side, difficulty, limits);
  let step = iterator.next();
  while (!step.done) step = iterator.next();
  return step.value;
}

/** 搜索内部的已结算快照复用原字符串键，外部模拟仍默认使用原始查询。 */
function distribution(
  ctx: Context,
  s: GameState,
  c: Command,
  limit = 12,
  samples = 3,
  salt = 0,
  sampleKey?: string,
) {
  return rawDistribution(s, c, limit, samples, salt, sampleKey, ctx.keys.positionKey);
}
