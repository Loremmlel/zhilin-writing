import type { Effect, Kind } from '../types';

/** 只描述规则知识，不保存状态实例或参与结算；具体数值、时钟和来源仍由引擎局面决定。 */
export interface KeywordDefinition {
  name: string;
  category: '持续状态' | '行动特性' | '战斗与保护';
  description: string;
  aliases?: readonly string[];
  sources: readonly Kind[];
}

export const KEYWORDS = {
  'attack-up': {
    name: '攻击强化',
    category: '持续状态',
    aliases: ['加攻', '鼓舞', '攻击力增益'],
    description: '暂时提高攻击力。不同施放可以叠加；具体数值、生效时间与剩余时间见当前状态。',
    sources: [6, 'u21'],
  },
  'attack-down': {
    name: '攻击削弱',
    category: '持续状态',
    aliases: ['减攻'],
    description:
      '暂时降低攻击力。具体数值和持续时间由来源决定，攻击力最低为0；治疗型单位遵循其专属规则。',
    sources: ['s16'],
  },
  immune: {
    name: '金身',
    category: '持续状态',
    description: '免疫伤害及敌方技能、法术，包括处决附魔和策反附魔。不能阻止己方献祭等非伤害效果。',
    sources: [17],
  },
  execute: {
    name: '处决附魔',
    category: '持续状态',
    aliases: ['处决'],
    description:
      '在下个实际己方回合，首次命中敌方随从时将其处决。绕过名刀保护，金身仍可阻止；不能处决基地。触发即消耗，未触发则在该己方回合结束失效，冲锋号令不能提前生效。',
    sources: [18],
  },
  convert: {
    name: '策反附魔',
    category: '持续状态',
    description:
      '在下个实际己方回合，攻击实际造成伤害后，将存活的敌方随从变为友方。零伤害不触发、不消耗；新友方本回合疲劳。未触发则在该己方回合结束失效，冲锋号令不能提前生效。CX的概率策反直接结算换边，不使用这个附魔窗口。',
    sources: [22, 's3'],
  },
  'inner-fire': {
    name: '心灵之火',
    category: '持续状态',
    description:
      '使目标攻击力随当前生命变化。可对敌方使用，因此也可能降低攻击；治疗型单位遵循其专属规则。',
    sources: ['u26'],
  },
  mark: {
    name: '投石标记',
    category: '持续状态',
    description:
      '满血目标立即引爆；否则等待同阵营非投石机的后续命中。标记可叠加，触发时逐层结算并移除，每层独立判定免伤。',
    sources: [10],
  },
  freeze: {
    name: '冰冻',
    category: '持续状态',
    aliases: ['冻结'],
    description:
      '不能行动，保留原阵营，友方攻击可以穿过。通常保留常驻光环与被动，但万法真君反制暂停。持续时间与双方回合结束时的扣血由来源决定。',
    sources: ['u5', 'u24'],
  },
  burn: {
    name: '灼烧',
    category: '持续状态',
    description: '在双方回合结束时持续受到伤害。伤害与剩余时间由来源决定；不阻止行动。',
    sources: ['u6', 'u28'],
  },
  stun: {
    name: '眩晕',
    category: '持续状态',
    description:
      '暂时不能行动，不改变阵营，也不移除技能。同一次攻击还可能施加独立的沉默；眩晕结束不代表沉默解除。',
    sources: ['u4'],
  },
  silence: {
    name: '沉默',
    category: '持续状态',
    description:
      '原有及继承的技能、对应被动失效。基础属性、已获得的永久属性和装备保留。钩子免疫等明确保留的身份限制不被解除。',
    sources: ['u4'],
  },
  charge: {
    name: '冲锋',
    category: '行动特性',
    description:
      '免除部署当回合的行动等待。仍须满足蓄力要求，也仍受冰冻、眩晕等限制。冲锋号令则是立即推进个人时钟的法术，会刷新操作，不能与冲锋混为一谈。',
    sources: [1, 'u1', 'u12', 'u12p', 's1', 'u17'],
  },
  reserve: {
    name: '蓄力',
    category: '行动特性',
    description:
      '主动积累层数，供后续攻击、移动或技能使用。就绪条件、层数上限和消耗方式由具体能力决定；蓄力带来的攻击提升不等于永久成长。',
    sources: [4, 15, 21, 'u2', 'u6', 'formless'],
  },
  fatigue: {
    name: '疲劳／休眠',
    category: '行动特性',
    aliases: ['部署疲劳', '疲劳', '休整'],
    description:
      '暂时不能行动。普通随从通常部署后下一己方回合可行动；独行侠还需额外休眠一个己方回合。策反后的棋子本回合疲劳。地标归零后的休眠属于地标重建规则，见地标卡片。',
    sources: [23, 22, 'u17'],
  },
  'extra-operation': {
    name: '额外完整操作',
    category: '行动特性',
    description:
      '额外获得一次选择移动、攻击、技能或蓄力的机会，仍遵守各操作条件。攻击模式内的多次攻击属于同一次完整操作。',
    sources: ['u27', 's1', 's12'],
  },
  'extra-attack': {
    name: '额外攻击操作',
    category: '行动特性',
    description:
      '额外执行一次攻击操作，攻击次数按自身属性计算；不能改成移动或技能。靴子在一次移动操作完成后触发一次。',
    sources: ['u16'],
  },
  piercing: {
    name: '穿透',
    category: '战斗与保护',
    description:
      '沿合法路径依次攻击多个敌方目标。路径由来源决定：杀圣使用四向直线，炎魔之心允许逐格选择转弯路径。',
    sources: ['slayer', 'u28'],
  },
  lifesteal: {
    name: '吸血',
    category: '战斗与保护',
    description:
      '按实际攻击伤害和吸血比例回复自身生命，不超过生命上限。比例、触发次数与限制由来源决定，禁疗会阻止治疗。',
    sources: ['u8', 'u11', 'slayer'],
  },
  critical: {
    name: '暴击',
    category: '战斗与保护',
    aliases: ['重击'],
    description:
      '攻击按一定概率提高伤害。概率、倍率或固定伤害由来源决定；同一攻击的不同概率区间遵循该单位的专属规则。',
    sources: [1, 'u1', 'u8'],
  },
  reflect: {
    name: '反伤',
    category: '战斗与保护',
    description:
      '杀圣将实际受到伤害的50%返还给来源，致死伤害也会触发；反伤不会再次触发反伤。超级跑得快的死亡反伤按其独立死亡判定结算。',
    sources: ['slayer', 20],
  },
  retaliation: {
    name: '反击',
    category: '战斗与保护',
    description:
      '受伤后向伤害来源发动普通攻击，需要满足射程等条件，不占主动操作。同一来源链不会无限互相反击；死亡时的特殊反击按来源说明结算。',
    sources: ['u18', 20],
  },
  counter: {
    name: '法术反制',
    category: '战斗与保护',
    aliases: ['万法反制', '反制'],
    description:
      '使对手法术无效，但仍消耗法术牌。多个来源按入场顺序尝试，首次成功后停止。沉默时不反制；万法真君冰冻时也停用，普通法术反制小法师不受冰冻影响。',
    sources: ['u3', 'archmage'],
  },
  guard: {
    name: '名刀保护',
    category: '战斗与保护',
    aliases: ['致命伤害保护'],
    description:
      '阻止一次致命伤害，使目标以1点生命存活。每个来源对每个目标独立记录次数；离开范围或来源失效时不再提供保护，重新进入范围不会补回已用次数。处决附魔可以绕过。',
    sources: [3],
  },
  protection: {
    name: '免疫塔保护',
    category: '战斗与保护',
    description:
      '为范围内友方阻挡敌方法术或技能效果。每次成功由来源支付15点生命上限；上限归零时来源离场。',
    sources: ['u15'],
  },
  'freeze-immunity': {
    name: '冰冻免疫',
    category: '战斗与保护',
    aliases: ['免疫冰冻', '免冰冻'],
    description: '不会被施加冰冻。其他控制效果仍按各自规则结算。',
    sources: ['u28'],
  },
  'hook-immunity': {
    name: '钩子免疫',
    category: '战斗与保护',
    description:
      '不能被钩子类技能牵引，普通击退不受此限制。沉默不会解除这项限制。被巨大化的其他棋子不会因此获得钩子免疫。',
    sources: [5],
  },
  giant: {
    name: '巨大化',
    category: '战斗与保护',
    description:
      '变为2×2占位，生命变化由来源决定。移动和落位必须检查全部占用格；不会因此获得大肉比的身份与专属技能。',
    sources: ['u7'],
  },
  siphon: {
    name: '灵魂虹吸',
    category: '战斗与保护',
    aliases: ['虹吸'],
    description:
      '建立扣血端和治疗端，回合结束分别结算。任一端离开施法者射程，整条连接失效。扣血与治疗分别按伤害、免疫和禁疗规则处理。',
    sources: ['u14'],
  },
  'attack-aura': {
    name: '攻击光环',
    category: '战斗与保护',
    aliases: ['先师光环'],
    description:
      '攻击加成随来源是否有效、目标是否在范围内实时变化。多个有效来源可以叠加；具体范围与数值由来源决定。举旗还提供独立的生命加成。',
    sources: ['sage', 's8'],
  },
  'healing-block': {
    name: '禁疗',
    category: '战斗与保护',
    aliases: ['不能被治疗'],
    description:
      '无法通过治疗回复生命，直到提供禁疗的效果失效。生命上限变化及伴随的生命调整仍遵循具体能力规则。',
    sources: ['s11'],
  },
} as const satisfies Record<string, KeywordDefinition>;

export type KeywordId = keyof typeof KEYWORDS;
export type RuleReference = { type: 'unit'; kind: Kind } | { type: 'keyword'; id: KeywordId };
export const KEYWORD_IDS = Object.keys(KEYWORDS) as KeywordId[];
export const keywordDefinition = (id: KeywordId): KeywordDefinition => KEYWORDS[id];

/** 状态实例到词条的唯一映射；正负攻击共用存档类型，但展示为不同的规则身份。 */
export function effectKeyword(effect: Effect): KeywordId {
  return effect.type === 'attack'
    ? (effect.amount ?? 0) < 0
      ? 'attack-down'
      : 'attack-up'
    : effect.type;
}
