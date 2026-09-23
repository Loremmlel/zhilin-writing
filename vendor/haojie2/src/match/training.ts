import { createGame, applyCommand } from '../engine/commands/game';
import { actorCommandError, parseCommand } from '../engine/online/authority';
import { HAOJIE_RULESET } from '../engine/online/player-view';
import { ensure } from '../engine/core/state';
import type { GameState, Player } from '../engine/types';
import { decisionOwner, observe } from '../ai/observation';

export interface TrainingOptions {
  seed?: number;
  rules?: 'classic' | 'shrine';
  maxCommands?: number;
  maxPlies?: number;
}

/** 这是终局收益，不是每次读取都应累加的步进奖励；截断没有胜负标签。 */
export interface TrainingStatus {
  ruleset: typeof HAOJIE_RULESET;
  commands: number;
  ply: number;
  phase: GameState['phase'];
  toPlay: Player | null;
  terminated: boolean;
  truncated: boolean;
  truncation: 'commands' | 'plies' | null;
  winner: GameState['winner'] | null;
  returns: Record<Player, number> | null;
}

/**
 * 常驻训练环境持有权威局面，策略只能通过 observation 读取白名单。
 * 每步仍由 applyCommand 原子结算；不保存 Session 历史，也不做 IO 或计时。
 * 命令成功后才更新计数并清理表现记录，保留 serial、正式随机数和全部规则状态。
 * 外部取消可直接丢弃环境；达到训练上限明确截断，不强行结束回合或判胜。
 */
export class TrainingEnvironment {
  #state: GameState;
  #commands = 0;
  #initialPly: number;
  readonly #maxCommands: number;
  readonly #maxPlies: number;

  constructor(options: TrainingOptions = {}) {
    const { seed = 20260907, rules = 'classic', maxCommands = 10000, maxPlies = 500 } = options;
    ensure(
      Number.isSafeInteger(seed) && seed >= 1 && seed <= 0xffffffff,
      'seed 必须是非零 uint32。',
    );
    ensure(rules === 'classic' || rules === 'shrine', 'rules 必须是 classic 或 shrine。');
    for (const n of [maxCommands, maxPlies])
      ensure(Number.isSafeInteger(n) && n > 0, '训练上限必须是正整数。');
    this.#state = createGame(seed, rules);
    this.#state.log = [];
    this.#state.events = [];
    this.#initialPly = this.#state.ply;
    this.#maxCommands = maxCommands;
    this.#maxPlies = maxPlies;
  }

  /** 仅供宿主导入可信引擎局面/回放；不向策略或标准输出提供反向导出权威状态的接口。 */
  static fromState(
    state: GameState,
    limits: Pick<TrainingOptions, 'maxCommands' | 'maxPlies'> = {},
  ) {
    const env = new TrainingEnvironment(limits);
    env.#state = structuredClone({ ...state, log: [], events: [] });
    env.#initialPly = state.ply;
    return env;
  }

  /** 记录实际截断边界，重放不能依赖生成脚本的默认参数。 */
  limits() {
    return { maxCommands: this.#maxCommands, maxPlies: this.#maxPlies };
  }

  status(): TrainingStatus {
    const s = this.#state;
    const terminated = s.winner !== undefined;
    const truncation = terminated
      ? null
      : this.#commands >= this.#maxCommands
        ? 'commands'
        : s.ply - this.#initialPly >= this.#maxPlies
          ? 'plies'
          : null;
    return {
      ruleset: HAOJIE_RULESET,
      commands: this.#commands,
      ply: s.ply,
      phase: s.phase,
      toPlay: terminated || truncation ? null : decisionOwner(s),
      terminated,
      truncated: truncation !== null,
      truncation,
      winner: s.winner ?? null,
      returns: terminated
        ? {
            1: s.winner === 'draw' ? 0 : s.winner === 1 ? 1 : -1,
            2: s.winner === 'draw' ? 0 : s.winner === 2 ? 1 : -1,
          }
        : null,
    };
  }

  observation(viewer: Player = decisionOwner(this.#state)) {
    ensure(viewer === 1 || viewer === 2, 'viewer 必须是 1 或 2。');
    return observe(this.#state, viewer);
  }

  frame(viewer: Player = decisionOwner(this.#state)) {
    return { ...this.status(), viewer, observation: this.observation(viewer) };
  }

  /** 允许合法的回合外巨大化和双方暗选，不能用 toPlay 代替操作者权限校验。 */
  step(actor: Player, input: unknown): TrainingStatus {
    const status = this.status();
    ensure(!status.terminated && !status.truncated, '训练对局已终止或截断，请显式 reset。');
    const command = parseCommand(input);
    const error = actorCommandError(this.#state, actor, command);
    ensure(!error, error ?? '操作者无权执行命令。');
    const next = applyCommand(
      this.#state,
      command.type === 'choose-shrine' ? { ...command, player: actor } : command,
    );
    // 事件在结算过程中仍完整生成，不能跳过依赖事件的事实关联或改变身份序号。
    next.events = [];
    next.log = [];
    this.#state = next;
    this.#commands++;
    return this.status();
  }
}
