import { applyCommand } from './game';
import { definition } from './catalog';
import { ensure } from './state';
import { allPieces, hasTrait } from './traits';
import type { Command, GamePosition, GameState, Kind, Player } from './types';

const commandTypes = new Set<Command['type']>([
  'end',
  'summon',
  'begin',
  'reroll',
  'deploy',
  'move',
  'attack',
  'charge',
  'skill',
  'cast',
  'equip',
  'craft',
  'synthesize',
  'skip-synthesis',
  'react',
  'finish-mode',
  'choose-shrine',
  'finish-shrine-setup',
  'activate-aura',
  'extra-summon',
  'choose-summons',
  'clock',
  'shatter',
]);
const idFields = new Set(['unitId', 'cardId', 'targetId', 'secondId', 'deathId', 'recipeId']);
const kindFields = new Set(['shrineKind', 'chosenKind', 'ability']);
const idsFields = new Set(['materialIds', 'cardIds', 'sacrificeIds']);
const booleanFields = new Set(['ultimate', 'charge']);
const coordinateFields: Record<string, number> = { x: 9, y: 13, column: 9, row: 13 };
const id = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 128;
const integer = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max;
const record = (v: unknown): v is Record<string, unknown> =>
  !!v &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
function validKind(v: unknown): boolean {
  if (!(typeof v === 'string' && v.length <= 32) && !integer(v, 1, 26)) return false;
  try {
    return definition(v as Kind).id === v;
  } catch {
    return false;
  }
}

/** Parse an untrusted JSON value, not a TypeScript assertion. The host also bounds wire bytes. */
export function parseCommand(input: unknown): Command {
  ensure(record(input), '命令必须是普通JSON对象。');
  ensure(
    typeof input.type === 'string' && commandTypes.has(input.type as Command['type']),
    '无法识别的游戏命令。',
  );
  const output: Record<string, unknown> = { type: input.type };
  for (const [key, value] of Object.entries(input)) {
    if (key === 'type') continue;
    let valid = false;
    if (idFields.has(key)) valid = id(value);
    else if (kindFields.has(key)) valid = validKind(value);
    else if (idsFields.has(key))
      valid =
        Array.isArray(value) &&
        value.length <= 128 &&
        value.every(id) &&
        new Set(value).size === value.length;
    else if (booleanFields.has(key)) valid = typeof value === 'boolean';
    else if (Object.hasOwn(coordinateFields, key)) valid = integer(value, 1, coordinateFields[key]);
    else if (key === 'player') valid = value === 1 || value === 2;
    else if (key === 'parity') valid = value === 'odd' || value === 'even';
    else if (key === 'direction') valid = ['up', 'down', 'left', 'right'].includes(value as string);
    else if (key === 'mode')
      valid = typeof value === 'string' && value.length > 0 && value.length <= 32;
    else if (key === 'offerIndices')
      valid =
        Array.isArray(value) &&
        value.length <= 16 &&
        value.every((v) => integer(v, 0, 15)) &&
        new Set(value).size === value.length;
    else if (key === 'path') {
      valid =
        Array.isArray(value) &&
        value.length <= 256 &&
        value.every(
          (p) =>
            record(p) && Object.keys(p).length === 2 && integer(p.x, 1, 9) && integer(p.y, 1, 13),
        );
    }
    ensure(valid, `命令参数 ${key} 的类型、范围或结构不合法。`);
    output[key] = structuredClone(value);
  }
  // Required/conditional game parameters are checked by the same rule functions as local play.
  return output as unknown as Command;
}

/** Authorization only; accepts incomplete UI intents. Costs, targets and phases remain engine rules. */
export function actorCommandError(s: GamePosition, actor: Player, c: Command): string | null {
  if (actor !== 1 && actor !== 2) return '操作者必须是已认证的对局席位。';
  if (c.player !== undefined && c.player !== actor) return '命令阵营与已认证席位不一致。';
  if (s.winner) return '对局已经结束。';
  if (s.pending.length)
    return c.type === 'react' && s.pending[0].owner === actor
      ? null
      : '请由效果所属玩家处理当前反应。';
  if (s.phase === 'shrine-draft') {
    if (c.type !== 'choose-shrine') return '请先秘密选择神龛。';
    return s.shrineDraft?.committed[actor] ? '本方已经锁定神龛。' : null;
  }
  const unit = c.unitId ? allPieces(s).find((u) => u.id === c.unitId) : undefined;
  if (c.unitId && (!unit || unit.owner !== actor)) return '不能操纵另一方或不存在的棋子。';
  if (actor === s.active) return null;
  // Free giant expansion is the current rule's sole out-of-turn unit command. Do not use active
  // or decisionOwner as a global network lock: the rule engine checks silence/freeze/cost/placement.
  if (c.type === 'skill' && unit && (c.ability ?? unit.kind) === 'u7' && hasTrait(unit, 'u7'))
    return null;
  return '当前操作不属于你的席位。';
}

/** The host authenticates actor, serializes room commands and persists this result before ack. */
export function applyPlayerCommand(previous: GameState, actor: Player, input: unknown): GameState {
  const c = parseCommand(input);
  const error = actorCommandError(previous, actor, c);
  ensure(!error, error ?? '没有操作权限。');
  return applyCommand(previous, c.type === 'choose-shrine' ? { ...c, player: actor } : c);
}

/** Only the independent, once-per-game secret choices can safely rebase after the other seat
 * committed. The host remains ignorant of individual game modes; all ordinary stale actions fail. */
export function canRebasePlayerCommand(s: GamePosition, actor: Player, c: Command): boolean {
  return (
    s.phase === 'shrine-draft' &&
    c.type === 'choose-shrine' &&
    actorCommandError(s, actor, c) === null
  );
}
