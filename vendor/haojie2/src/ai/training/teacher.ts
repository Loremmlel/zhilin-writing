import { allocateBudget, emptyBudget, type TurnBudget } from '../budget';
import { cachedDecision } from '../planning/plan-cache';
import { decide } from '../planning/search';
import { decisionOwner, imagined } from '../observation';
import { ensure } from '../../engine/core/state';
import type { Player } from '../../engine/types';
import type { Difficulty, Observation, PlanStep } from '../types';
import { trainingPosition } from './queries';

/**
 * 热启动教师只接收公开观察，共用现有预算、搜索和缓存收尾策略。
 * 每局创建新实例；双方预算分别记账，未决反应按实际所有者处理。
 * 不接收墙钟预算，不伪造 MCTS 访问次数；超过原有命令保护上限明确报错。
 */
export class TrainingTeacher {
  readonly #budgets: Record<Player, TurnBudget> = { 1: emptyBudget(), 2: emptyBudget() };
  readonly #plans: Record<Player, PlanStep[]> = { 1: [], 2: [] };

  constructor(
    readonly difficulty: Difficulty = 'easy',
    readonly simulations?: number,
  ) {
    ensure(['easy', 'medium', 'hard'].includes(difficulty), '教师难度不合法。');
    ensure(
      simulations === undefined || (Number.isSafeInteger(simulations) && simulations >= 40),
      '教师节点预算至少为40。',
    );
  }

  next(observation: Observation) {
    trainingPosition(observation);
    const side = decisionOwner(observation);
    if (this.#budgets[side].ply !== observation.ply) {
      this.#budgets[side] = { ...emptyBudget(), ply: observation.ply };
      this.#plans[side] = [];
    }
    const budget = this.#budgets[side];
    ensure(budget.commands < 200, '教师本回合达到200条命令，请暂停检查，未自动结束回合。');
    const decision =
      cachedDecision(observation, this.#plans[side]) ??
      decide(observation, side, this.difficulty, {
        ...allocateBudget(imagined(observation), this.difficulty, budget),
        ...(this.simulations === undefined ? {} : { simulations: this.simulations }),
        mode: 'work',
        trace: false,
      });
    ensure(decision.command, '教师没有合法候选，请检查局面；未跳过反应或未部署手牌。');
    this.#plans[side] = decision.plan.slice(1);
    budget.nodes += decision.stats.simulations;
    budget.commands++;
    return decision;
  }
}
