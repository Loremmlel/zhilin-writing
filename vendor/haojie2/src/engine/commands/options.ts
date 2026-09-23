import {
  chargeFor,
  moveChargeKind,
  attackChargeKind,
  abilityKinds,
  allPieces,
  canDeployKind,
  hasTrait,
  isLandmark,
  signedAttack,
} from '../core/traits';
import { canShatter } from '../setup/shrines';
/** 与渲染器无关的命令说明；界面负责选值，引擎负责验证。 */
import { definition, isStored } from '../catalog';
import { rerollCommands } from '../setup/summoning';
import { queryCommandError } from './game';
import {
  age,
  allegiance,
  getStats,
  has,
  now,
  passive,
  healingAttack,
  hasWeapon,
} from '../core/state';
import type { Card, Command, GamePosition, Unit } from '../types';
export interface SelectionStep {
  kind: 'target' | 'point' | 'row' | 'column' | 'death' | 'direction' | 'path';
  field?: 'targetId' | 'secondId' | 'sacrificeIds';
  label: string;
  relation?: 'friend' | 'enemy' | 'any';
  unitOnly?: boolean;
  range?: boolean;
}
export interface ActionSpec {
  id: string;
  label: string;
  icon: string;
  command: Command;
  steps: SelectionStep[];
  free?: boolean;
  hint?: string;
}
const target = (
  label: string,
  relation: 'friend' | 'enemy' | 'any' = 'enemy',
  field: SelectionStep['field'] = 'targetId',
  range = true,
  unitOnly = true,
): SelectionStep => ({ kind: 'target', label, relation, field, range, unitOnly });
const square = (label = '选择高亮落点'): SelectionStep => ({ kind: 'point', label });
const spec = (
  id: string,
  label: string,
  command: Command,
  steps: SelectionStep[] = [],
  icon = 'spark',
  free = false,
): ActionSpec => ({ id, label, command, steps, icon, free });
export function unitActions(s: GamePosition, u: Unit): ActionSpec[] {
  if (isLandmark(u) && u.hp <= 0) return [];
  const result: ActionSpec[] = [],
    stats = getStats(s, u),
    command = { unitId: u.id };
  if (stats.move > 0)
    result.push(spec('move', '移动', { type: 'move', ...command }, [square()], 'move'));
  if (stats.actions > 0 && (u.silenced || !hasTrait(u, 'firelord'))) {
    if (signedAttack(u)) {
      result.push(
        spec(
          'attack',
          '攻击 · 造成伤害',
          { type: 'attack', ...command, mode: 'damage' },
          [target('选择伤害目标（可选友方）', 'any', 'targetId', true, false)],
          'sword',
        ),
      );
      result.push(
        spec(
          'heal',
          '攻击 · 治疗生命',
          { type: 'attack', ...command, mode: 'heal' },
          [target('选择治疗目标', 'any')],
          'spark',
        ),
      );
    } else
      result.push(
        spec(
          'attack',
          healingAttack(u) ? '攻击 / 治疗' : '攻击',
          { type: 'attack', ...command },
          [target('选择高亮目标', 'any', 'targetId', true, false)],
          'sword',
        ),
      );
  }
  if (stats.actions > 0 && (u.silenced || !hasTrait(u, 'firelord'))) {
    if (healingAttack(u))
      result.push(
        spec(
          'self-heal',
          '治疗自身',
          { type: 'attack', ...command, targetId: u.id, mode: 'heal' },
          [],
          'spark',
        ),
      );
    if (hasWeapon(u, 'u28'))
      result.push(
        spec(
          'attack-path',
          '自选穿透路径',
          { type: 'attack', ...command, mode: 'damage', path: [] },
          [{ kind: 'path', label: '先选自身出发格，再逐格选择路径；可转弯，选好后确认攻击' }],
          'sword',
        ),
      );
  }
  if (canShatter(s, u))
    result.push(
      spec(
        'shatter',
        '玉碎 · 自杀伤敌',
        { type: 'shatter', ...command },
        [target('选择玉碎伤害目标；自杀不产人头', 'enemy', 'targetId', true, false)],
        'sword',
      ),
    );
  if (u.mode === 'move' || u.mode === 'attack')
    result.push(spec('finish', '结束本次操作', { type: 'finish-mode', ...command }, [], 'check'));
  if (moveChargeKind(u) === u.kind)
    result.push(
      spec('charge-move', '蓄力 · 移动', { type: 'charge', ...command, mode: 'move' }, [], 'clock'),
    );
  if (attackChargeKind(u) === u.kind)
    result.push(
      spec(
        'charge-attack',
        '蓄力 · 攻击',
        { type: 'charge', ...command, mode: 'attack' },
        [],
        'clock',
      ),
    );
  if (!u.silenced) {
    if (u.kind === 4 || u.kind === 15 || u.kind === 'u2')
      result.push(
        spec(
          'charge-attack',
          u.kind === 15 ? '蓄力 · +5攻击 / +1射程' : '蓄力 · 攻击',
          { type: 'charge', ...command, mode: 'attack' },
          [],
          'clock',
        ),
      );
    if (u.kind === 21 || u.kind === 'u6')
      result.push(
        spec(
          'charge-skill',
          '蓄力 · 技能',
          { type: 'charge', ...command, mode: 'skill' },
          [],
          'clock',
        ),
      );
    const skill = { type: 'skill' as const, ...command };
    switch (u.kind) {
      case 5:
        result.push(spec('stomp', '震地 · 周围15伤', skill));
        break;
      case 6:
        result.push(spec('buff', '鼓舞友军', skill));
        break;
      case 7:
        result.push(
          spec('hook', '牵引', skill, [
            target('牵引 1/2：选择敌方随从'),
            square('牵引 2/2：选择新落点'),
          ]),
        );
        break;
      case 14:
        result.push(
          spec('sacrifice-summon', '献祭同类 · 获得召唤', { ...skill, mode: 'summon' }, [
            target('选择射程内另一枚献祭炮', 'friend'),
          ]),
          spec('sacrifice', '献祭射击', skill, [
            target('献祭 1/2：选择另一友方', 'friend'),
            { kind: 'column', label: '献祭 2/2：选择射击列，可命中敌方基地' },
          ]),
        );
        break;
      case 19:
        result.push(spec('wall', '制造路障', skill, [square('选择射程内路障位置')]));
        break;
      case 21:
        result.push(
          spec('dash', '神行突袭', skill, [
            square('突袭 1/2：选择6格内落点'),
            target('突袭 2/2：选择落点射程内目标', 'enemy', 'targetId', true, false),
          ]),
        );
        break;
      case 'u6':
        result.push(
          spec('cross', '十字浩劫 · 一生一次', skill, [square('选择11×11区域内十字交点')]),
        );
        break;
      case 'u7':
        result.push(
          spec(
            'giant',
            '巨大化 · 免费',
            skill,
            [
              target('巨大化 1/2：选择有扩展空间的棋子（可选敌方）', 'any', 'targetId', false),
              square('巨大化 2/2：选择新2×2的左上角；预览必须包含原格'),
            ],
            'spark',
            true,
          ),
        );
        break;
      case 'u14':
        result.push(
          spec(
            'siphon',
            '虹吸 · 每回合一次',
            skill,
            [
              target('虹吸 1/2：选择每回合扣20血的目标', 'any', 'targetId', true, false),
              target('虹吸 2/2：选择每回合回复20血的目标', 'any', 'secondId', true, false),
            ],
            'spark',
          ),
        );
        break;
      case 'u19':
        result.push(
          spec('revive', '复活', skill, [
            { kind: 'death', label: '复活 1/2：选择阵亡记录' },
            square('复活 2/2：选择射程内落点'),
          ]),
        );
        break;
      case 'u21':
        result.push(
          spec('single-buff', '鼓舞一名友方', skill, [target('选择下回合+10攻击的友方', 'friend')]),
        );
        break;
      case 'u23':
        result.push(
          spec('superhook', '超级牵引', skill, [
            target('选择任意敌方，牵引到身前', 'enemy', 'targetId', false),
          ]),
        );
        break;
      case 'u24':
        result.push(spec('ice-mark', '寒冰标记', skill, [square('选择11×11内标记格，下回合判定')]));
        break;
    }
  }
  if (!u.silenced)
    for (const kind of u.traits ?? []) {
      const usage = u.abilityUsage?.[kind];
      const borrowed = {
        ...u,
        ...chargeFor(u, kind),
        kind,
        traits: undefined,
        onceUsed: usage?.once ?? false,
        freeUsed: usage?.free ?? -1,
      };
      for (const a of unitActions(s, borrowed))
        if (a.command.type === 'skill' || a.command.type === 'charge')
          result.push({
            ...a,
            id: `${a.id}:${kind}`,
            label: `${definition(kind).name} · ${a.label}`,
            command: { ...a.command, ability: kind },
          });
    }
  return result;
}
export function cardActions(s: GamePosition, c: Card): ActionSpec[] {
  const d = definition(c.kind),
    base = { cardId: c.id };
  const result: ActionSpec[] = [];
  if (canDeployKind(c.kind)) {
    result.push(
      spec(
        'deploy',
        c.kind === 1
          ? '正常部署 · 不扣血'
          : d.landmark
            ? '部署地标'
            : d.tier === 'shrine'
              ? '部署神龛'
              : '部署随从',
        { type: 'deploy', ...base, charge: false },
        [square('选择部署格；2×2以该格为左上角')],
        'plus',
      ),
    );
    if (c.kind === 1)
      result.push(
        spec(
          'deploy-charge',
          '扣10血 · 冲锋部署',
          { type: 'deploy', ...base, charge: true },
          [square('选择冲锋部署格；该随从本回合即可行动')],
          'sword',
        ),
      );
  } else if (d.aura)
    result.push(spec('activate-aura', '启用永久光环', { type: 'activate-aura', ...base }));
  else if (d.weapon !== undefined)
    result.push(
      spec(
        'equip',
        '装备武器',
        { type: 'equip', ...base },
        [target('选择友方装备；已有武器会被替换', 'friend', 'targetId', false)],
        'sword',
      ),
    );
  else if (c.kind === 8)
    result.push(
      spec('blast', '施放爆弹', { type: 'cast', ...base }, [square('选择2×2爆弹区域的左上格')]),
    );
  else if (c.kind === 25) {
    result.push(spec('reforge-one', '重铸 · 召唤一次', { type: 'cast', ...base, mode: 'single' }));
    result.push(
      spec('reforge-two', '献祭两名 · 召唤两次', { type: 'cast', ...base, mode: 'double' }, [
        target('选择第一名至少半血的友方', 'friend', 'sacrificeIds', false),
        target('选择第二名至少半血的友方', 'friend', 'sacrificeIds', false),
      ]),
    );
  } else if (c.kind === 'u9')
    result.push(
      spec('storm-row', '烈焰风暴 · 横排', { type: 'cast', ...base, mode: 'row' }, [
        { kind: 'row', label: '选择受到两次烈焰风暴的横排' },
      ]),
      spec('storm-col', '烈焰风暴 · 竖排', { type: 'cast', ...base, mode: 'column' }, [
        { kind: 'column', label: '选择受到两次烈焰风暴的竖排' },
      ]),
    );
  else
    result.push(
      spec('cast', `施放${d.name}`, { type: 'cast', ...base }, [
        target('选择法术目标', c.kind === 'u26' ? 'any' : 'friend', 'targetId', false),
      ]),
    );
  for (const command of rerollCommands(s, c)) {
    const mage = s.units.find((u) => u.id === command.unitId);
    result.push(
      spec(
        mage ? `reroll-${mage.id}` : 'self-reroll',
        mage ? `改判 · (${mage.x},${mage.y})` : '改判自身 · 前5回合',
        command,
      ),
    );
  }
  return result;
}
export function reactionAction(s: GamePosition): ActionSpec | null {
  const r = s.pending[0];
  if (!r) return null;
  if (r.kind === 'hit-pull')
    return {
      ...spec('hit-pull', '牵引命中目标', { type: 'react', mode: 'pull' }),
      hint: '可将刚命中的存活棋子拉到无相勾身前，或放弃。',
    };
  if (r.kind === 'bounce')
    return spec('bounce', 'SZF必须弹出', { type: 'react' }, [
      square('选择上下左右一格免费弹出；连续撞击继续弹出'),
    ]);
  if (r.kind === 'hut-spawn')
    return spec('hut-spawn', '小屋死亡召唤', { type: 'react' }, [
      square('选择小屋射程内位置，召唤超级跑得快'),
    ]);
  return spec(
    r.kind,
    r.kind === 'death-shot' ? '奶妈临终行动' : `伤害转化 · ${r.amount}`,
    { type: 'react' },
    [
      target(
        r.kind === 'death-shot' ? '效果所属玩家选择无距离限制的攻击或治疗目标' : '选择伤害转化目标',
        'any',
        'targetId',
        false,
        false,
      ),
    ],
  );
}
export function actionError(s: GamePosition, a: ActionSpec): string | null {
  const id = a.id.split(':')[0];
  if (!a.steps.length) return queryCommandError(s, a.command);
  if (s.winner) return '对局已经结束。';
  if (a.command.type === 'react') return null;
  if (s.pending.length) return '先处理待结算效果。';
  if (a.command.type === 'synthesize') return s.phase === 'synthesis' ? null : '合成仅限回合开始。';
  if (s.phase === 'shrine-setup' && ['deploy', 'equip', 'activate-aura'].includes(a.command.type))
    return null;
  if (s.phase !== 'play' && a.command.type !== 'reroll' && id !== 'giant')
    return '请先完成召唤阶段。';
  const u = a.command.unitId ? allPieces(s).find((v) => v.id === a.command.unitId) : undefined;
  if (!u) return null;
  const stats = getStats(s, u);
  const reserve = chargeFor(u, a.command.ability ?? u.kind);
  const moveCharge = moveChargeKind(u);
  const usage =
    a.command.ability && a.command.ability !== u.kind
      ? u.abilityUsage?.[a.command.ability]
      : undefined;
  const onceUsed =
    a.command.ability && a.command.ability !== u.kind ? (usage?.once ?? false) : u.onceUsed;
  const freeUsed =
    a.command.ability && a.command.ability !== u.kind ? (usage?.free ?? -1) : u.freeUsed;
  if (u.owner !== s.active && id !== 'giant') return '不是该随从所属方回合。';
  if (stats.frozen || stats.stunned || (stats.sleeping && id !== 'giant'))
    return '正在疲劳、休整、冰冻或眩晕中。';
  if (a.command.type === 'attack') {
    if (!stats.remaining) return '没有可用攻击操作。';
    if (hasTrait(u, 4) && !u.silenced && chargeFor(u, 4).readyCharge < 2)
      return '回合开始需要2层攻击蓄力。';
    return null;
  }
  if (
    !a.free &&
    ((u.mode !== 'none' && !(a.command.type === 'move' && u.mode === 'move')) ||
      stats.operationsLeft <= 0)
  )
    return '本回合已选其他模式或操作已用完。';
  if (
    a.command.type === 'move' &&
    moveCharge !== undefined &&
    u.mode === 'none' &&
    chargeFor(u, moveCharge).readyCharge < 1
  )
    return '须先蓄力，下一回合开始才可移动。';
  if (id === 'dash' && (reserve.readyCharge < 2 || u.hp <= 10))
    return '需2层已就绪的技能蓄力，且生命大于10。';
  if (id === 'cross' && (reserve.readyCharge < 1 || onceUsed))
    return '需要就绪的技能蓄力，且未使用过十字浩劫。';
  if (
    id === 'siphon' &&
    (freeUsed === s.ply || s.siphons.filter((l) => l.sourceId === u.id).length >= 3)
  )
    return '本回合虹吸已用，或已有3条连接。';
  if (a.free && (freeUsed === now(s, u) || (id === 'giant' && onceUsed)))
    return '免费能力的次数已经用完。';
  if (
    id === 'superhook' &&
    !(u.hookReadyAt !== undefined && u.hookReadyAt <= now(s, u) && u.hookExpiresAt! > now(s, u))
  )
    return '超级牵引仅在击杀后的下个己方回合可用。';
  return null;
}
