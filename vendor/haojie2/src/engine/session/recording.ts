import { RULESET_ID } from '../catalog';
import { applyCommand, createGame } from '../commands/game';
import { ensure } from '../core/state';
import { parseCommand } from '../online/authority';
import type { Command, GamePosition, GameState, Player } from '../types';
import type { MatchSettings } from '../../match/settings';
import { createSession, validState, type Session } from './history';

export interface CommandRecord {
  ruleset: string;
  origin: 'opening' | 'position';
  initial: GameState;
  commands: Command[];
  /** 仅供运行时重做；导出截断游标之后的尝试。 */
  cursor: number;
}

export interface RecordedSave {
  format: 'haojie-record-v1';
  ruleset: string;
  origin: CommandRecord['origin'];
  match?: MatchSettings;
  initial: GameState;
  commands: Command[];
  present: GameState;
}

/** 忽略对象字段顺序和未序列化的 undefined，比较全部规则、随机及表现字段。 */
export function stateText(value: unknown): string {
  return JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]]),
        )
      : item,
  );
}

export function startRecord(initial: GameState): CommandRecord {
  return {
    ruleset: RULESET_ID,
    origin:
      stateText(initial) === stateText(createGame(initial.seed, initial.mode))
        ? 'opening'
        : 'position',
    initial: structuredClone(initial),
    commands: [],
    cursor: 0,
  };
}

/** 反应、暗选与回合外巨大化的实际操作者不能一律使用 active。 */
export function recordedActor(
  state: Pick<GamePosition, 'pending' | 'active' | 'units' | 'landmarks'>,
  command: Command,
): Player {
  if (state.pending.length) return state.pending[0].owner;
  if (command.type === 'choose-shrine') return command.player ?? state.active;
  if (command.unitId) {
    const unit = [...state.units, ...(state.landmarks ?? [])].find((u) => u.id === command.unitId);
    if (unit) return unit.owner;
  }
  return state.active;
}

/**
 * 在同版引擎中重建指定决策点，只保留60份悔棋缓存及最近人类锚点。
 * 输入为已校验记录；重放不改变原记录、不产生IO，也不播放事件。失败向调用者抛出。
 */
export function restoreRecord(record: CommandRecord, match?: MatchSettings): Session {
  let present = record.initial;
  const past: GameState[] = [];
  let humanAnchor: GameState | undefined;
  let humanAnchorCursor: number | undefined;
  for (let i = 0; i < record.cursor; i++) {
    if (match?.mode === 'ai' && (present.pending[0]?.owner ?? present.active) === match.human) {
      humanAnchor = present;
      humanAnchorCursor = i;
    }
    past.push(present);
    if (past.length > 60) past.shift();
    present = applyCommand(present, record.commands[i]);
  }
  return {
    ...createSession(present, match),
    present,
    past,
    future:
      record.cursor < record.commands.length
        ? [applyCommand(present, record.commands[record.cursor])]
        : [],
    ...(humanAnchor ? { humanAnchor, humanAnchorCursor } : {}),
    record,
  };
}

/** 保存当前路线，既不输出运行时快照缓存，也不输出已撤销命令。 */
export function sessionSave(session: Session): RecordedSave {
  const record = session.record ?? startRecord(session.present);
  return {
    format: 'haojie-record-v1',
    ruleset: record.ruleset,
    origin: record.origin,
    ...(session.match ? { match: session.match } : {}),
    initial: record.initial,
    commands: record.commands.slice(0, record.cursor),
    present: session.present,
  };
}

export function serializeSession(session: Session): string {
  const save = sessionSave(session);
  ensure(save.commands.length <= 100_000, '命令记录超过10万步，无法导出为当前存档格式。');
  const text = JSON.stringify(save);
  ensure(text.length <= 24_000_000, '存档超过24MB，无法导出为当前存档格式。');
  return text;
}

/**
 * 不可信存档在替换会话之前完成结构、命令、规则版本及完整终态校验。
 * 旧规则记录不能静默套用新规则；恢复续玩缓存与校验使用同一次顺序重放。
 */
export function parseRecordedSave(value: RecordedSave): Session {
  ensure(value.ruleset === RULESET_ID, '存档规则版本与当前游戏不匹配，请使用对应版本打开。');
  ensure(value.origin === 'opening' || value.origin === 'position', '存档记录起点无效。');
  ensure(validState(value.initial) && validState(value.present), '存档局面损坏。');
  ensure(
    Array.isArray(value.commands) && value.commands.length <= 100_000,
    '存档命令记录无效或过长。',
  );
  const commands = value.commands.map(parseCommand);
  if (value.origin === 'opening')
    ensure(
      stateText(value.initial) === stateText(createGame(value.initial.seed, value.initial.mode)),
      '存档开局与种子不一致。',
    );
  const session = restoreRecord(
    {
      ruleset: value.ruleset,
      origin: value.origin,
      initial: value.initial,
      commands,
      cursor: commands.length,
    },
    value.match,
  );
  ensure(
    stateText(session.present) === stateText(value.present),
    '存档命令记录与当前局面不一致，文件可能损坏。',
  );
  return session;
}

/** 兼容内部会话JSON；缓存不可替代命令验证，重做只留在运行时。 */
export function parseRuntimeRecord(value: Session): Session {
  const record = value.record!;
  ensure(
    record &&
      Number.isSafeInteger(record.cursor) &&
      Array.isArray(record.commands) &&
      record.cursor >= 0 &&
      record.cursor <= record.commands.length &&
      record.commands.length <= 100_000,
    '存档命令游标损坏。',
  );
  const commands = record.commands.map(parseCommand);
  const session = parseRecordedSave({
    format: 'haojie-record-v1',
    ruleset: record.ruleset,
    origin: record.origin,
    initial: record.initial,
    commands: commands.slice(0, record.cursor),
    present: value.present,
    match: value.match,
  });
  session.record = { ...session.record!, commands, cursor: record.cursor };
  if (record.cursor < commands.length)
    session.future = [applyCommand(session.present, commands[record.cursor])];
  return session;
}
