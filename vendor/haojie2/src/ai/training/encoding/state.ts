import { definition } from '../../../engine/catalog';
import { basePoint, other } from '../../../engine/core/geometry';
import { ensure, getStats } from '../../../engine/core/state';
import { SYNTHESIS_RECIPES } from '../../../engine/setup/synthesis';
import type { Card, Command, Effect, Kind, Landmark, Player, Unit } from '../../../engine/types';
import type { Observation } from '../../types';
import { trainingPosition } from '../queries';
import {
  category,
  COMMANDS,
  DIRECTIONS,
  EFFECTS,
  kindFromKey,
  kindIndex,
  knownKeys,
  MODES,
  numeric,
  PHASES,
  REACTIONS,
  ROLES,
  UNIT_FIELDS,
  valuesInto,
  type EntityRole,
} from './schema';

const OBSERVATION_FIELDS = [
  'version',
  'serial',
  'ply',
  'active',
  'phase',
  'mode',
  'landmarks',
  'auras',
  'shrineDraft',
  'shrineSetupDone',
  'regularSummons',
  'summonOffer',
  'clockFrames',
  'summonSlots',
  'turns',
  'bases',
  'baseEffects',
  'heads',
  'hands',
  'bonus',
  'deployRows',
  'units',
  'pending',
  'deaths',
  'hazards',
  'siphons',
  'iceMarks',
  'winner',
];
const CARD_FIELDS = [
  'id',
  'kind',
  'drawnAt',
  'expiresAt',
  'group',
  'rerolled',
  'summonedPly',
  'summonPool',
  'parity',
];
const UNIT_KEYS = [
  ...UNIT_FIELDS,
  'id',
  'kind',
  'owner',
  'attacked',
  'guardSourceIds',
  'effects',
  'equipment',
  'traits',
  'abilityUsage',
  'abilityCharges',
  'equipmentIds',
  'receivedDamage',
  'group',
];
type Scalar = number | boolean | undefined;
interface RecordOptions {
  id?: string;
  owner?: Player;
  kind?: Kind;
  parent?: string;
  source?: string;
  target?: string;
  group?: string;
  order?: number;
  fields?: Scalar[];
  selectable?: boolean;
}

/**
 * 公开观察的纯编码器，不读取正式PRNG、不修改输入、不解析ID中的数字。
 * 主对象与附属状态各为一行；引用重编号保留同一来源/克隆组的关联，数组顺序保留叠放语义。
 * 所有已知嵌套字段有明确映射；未知字段或词表项报错，不能悄悄忽略新规则。
 * 不截断实体、亡者、反应或时钟快照。返回的索引表供动作编码使用，不是网络输入。
 */
export function encodePosition(observation: Observation, viewer: Player, prefix?: Command) {
  const s = trainingPosition(observation);
  ensure(viewer === 1 || viewer === 2, '编码观察方必须为1或2。');
  knownKeys(observation, OBSERVATION_FIELDS, 'Observation');
  ensure(observation.version === 2, '不支持此观察版本。');
  const entities: number[][] = [];
  const kinds: number[] = [];
  const indices = new Map<string, number>();
  const identities = new Map<string, number>();
  const reference = (id?: string): number => {
    if (id === undefined) return 0;
    ensure(typeof id === 'string' && !!id, '实体引用必须是非空字符串。');
    if (!identities.has(id)) identities.set(id, identities.size + 1);
    return identities.get(id)!;
  };
  const owner = (p?: Player) => {
    ensure(p === undefined || p === 1 || p === 2, '实体所属玩家不合法。');
    return p === undefined ? 0 : p === viewer ? 1 : -1;
  };
  const add = (role: EntityRole, o: RecordOptions = {}) => {
    const row = Array<number>(64).fill(0);
    row.splice(
      0,
      8,
      (ROLES.indexOf(role) + 1) / 32,
      owner(o.owner),
      reference(o.id) / 256,
      reference(o.parent) / 256,
      reference(o.source) / 256,
      reference(o.target) / 256,
      reference(o.group === undefined ? undefined : `group:${o.group}`) / 256,
      (o.order ?? 0) / 128,
    );
    valuesInto(row, o.fields ?? []);
    if (o.selectable && o.id && !indices.has(o.id)) indices.set(o.id, entities.length);
    entities.push(row);
    kinds.push(o.kind === undefined ? 128 + ROLES.indexOf(role) : kindIndex(o.kind));
  };
  const printed = (kind: Kind): Scalar[] => {
    const d = definition(kind);
    return [
      d.attack,
      d.health,
      d.range,
      d.actions,
      d.move,
      d.size ?? 1,
      d.mage,
      d.spell,
      d.weapon,
      d.aura,
    ];
  };
  const effect = (e: Effect, parent: string, order: number) => {
    knownKeys(e, ['type', 'from', 'until', 'owner', 'amount', 'sourceId', 'global'], 'Effect');
    add('effect', {
      owner: e.owner,
      parent,
      source: e.sourceId,
      order,
      fields: [category(e.type, EFFECTS), e.from, e.until, e.amount, e.global],
    });
  };
  const unit = (
    u: Unit | Landmark,
    role: 'unit' | 'landmark' | 'snapshot',
    parent?: string,
    order = 0,
  ) => {
    knownKeys(u, UNIT_KEYS, 'Unit');
    const data = u as unknown as Record<string, Scalar | string>;
    const fields = UNIT_FIELDS.map((name) =>
      name === 'mode' || name === 'chargeType'
        ? category(data[name] as string | undefined, MODES)
        : (data[name] as Scalar),
    );
    if (role !== 'snapshot') {
      const st = getStats(s, u);
      fields.push(
        st.attack,
        st.range,
        st.actions,
        st.remaining,
        st.move,
        st.operationLimit,
        st.operationsLeft,
        st.sleeping,
        st.frozen,
        st.stunned,
      );
    }
    const instance = role === 'snapshot' ? `${parent}:snapshot:${order}` : u.id;
    if (!indices.has(u.id)) indices.set(u.id, entities.length);
    add(role, {
      id: instance,
      source: role === 'snapshot' ? u.id : undefined,
      kind: u.kind,
      owner: u.owner,
      parent,
      group: u.group,
      order,
      fields,
    });
    u.effects.forEach((e, i) => effect(e, instance, i));
    u.attacked.forEach((id, i) =>
      add('attacked', { parent: instance, target: id, owner: u.owner, order: i }),
    );
    u.guardSourceIds?.forEach((id, i) =>
      add('guard', { parent: instance, source: id, owner: u.owner, order: i }),
    );
    u.receivedDamage?.forEach((hit, i) => {
      knownKeys(hit, ['ply', 'amount'], 'receivedDamage');
      add('received', {
        parent: instance,
        owner: u.owner,
        order: i,
        fields: [hit.ply, hit.amount],
      });
    });
    const equipment = [
      ...new Set([...u.equipment, ...Object.keys(u.equipmentIds ?? {}).map(kindFromKey)]),
    ];
    equipment.forEach((kind, i) =>
      add('equipment', {
        parent: instance,
        kind,
        owner: u.owner,
        id: u.equipmentIds?.[kind],
        order: i,
        fields: [u.equipment.includes(kind), ...printed(kind)],
      }),
    );
    const abilities = [
      ...new Set([
        ...(u.traits ?? []),
        ...Object.keys(u.abilityUsage ?? {}).map(kindFromKey),
        ...Object.keys(u.abilityCharges ?? {}).map(kindFromKey),
      ]),
    ];
    for (const kind of abilities) {
      const usage = u.abilityUsage?.[kind],
        charge = u.abilityCharges?.[kind];
      if (usage) knownKeys(usage, ['once', 'free'], 'abilityUsage');
      if (charge)
        knownKeys(charge, ['charge', 'readyCharge', 'chargeType', 'lastCharge'], 'abilityCharges');
      add('ability', {
        parent: instance,
        kind,
        owner: u.owner,
        fields: [
          u.traits?.includes(kind) ?? false,
          usage?.once,
          usage?.free,
          charge?.charge,
          charge?.readyCharge,
          category(charge?.chargeType, MODES),
          charge?.lastCharge,
        ],
      });
    }
  };
  const card = (c: Card, p: Player, role: 'card' | 'summon-offer', parent?: string, order = 0) => {
    knownKeys(c, CARD_FIELDS, 'Card');
    add(role, {
      id: c.id,
      kind: c.kind,
      owner: p,
      parent,
      group: c.group,
      order,
      selectable: true,
      fields: [
        c.drawnAt,
        c.expiresAt,
        c.rerolled,
        c.summonedPly,
        category(c.summonPool, ['normal', 'ultimate']),
        category(c.parity, ['odd', 'even']),
        ...printed(c.kind),
      ],
    });
  };
  const sides = [viewer, other(viewer)];
  // 预注册主对象；重命名ID不会改变网络张量，附属引用也不会扰乱后续主对象的编号。
  for (const p of sides) reference(`base-${p}`);
  for (const u of [...s.units, ...(s.landmarks ?? [])]) reference(u.id);
  for (const p of sides) for (const c of s.hands[p]) reference(c.id);
  for (const d of s.deaths) reference(d.id);
  for (const p of sides) {
    for (const pair of [s.turns, s.bases, s.heads, s.hands, s.bonus, s.baseEffects, s.deployRows])
      knownKeys(pair, ['1', '2'], '玩家记录');
    const at = basePoint(p);
    add('base', {
      id: `base-${p}`,
      owner: p,
      selectable: true,
      fields: [
        at.x,
        at.y,
        s.bases[p],
        s.turns[p],
        s.heads[p],
        s.bonus[p],
        ...Array.from({ length: 13 }, (_, i) => s.deployRows[p].includes(i + 1)),
      ],
    });
    s.baseEffects[p].forEach((e, i) => effect(e, `base-${p}`, i));
  }
  s.units.forEach((u, i) => unit(u, 'unit', undefined, i));
  s.landmarks?.forEach((u, i) => unit(u, 'landmark', undefined, i));
  for (const p of sides) s.hands[p].forEach((c, i) => card(c, p, 'card', undefined, i));
  s.deaths.forEach((d, i) => {
    knownKeys(d, ['id', 'kind', 'owner', 'ply', 'revived', 'group'], 'DeathRecord');
    add('death', {
      ...d,
      order: i,
      selectable: true,
      fields: [d.ply, d.revived, ...printed(d.kind)],
    });
  });
  s.hazards.forEach((h, i) => {
    knownKeys(h, ['id', 'owner', 'sourceId', 'axis', 'line', 'due'], 'Hazard');
    add('hazard', {
      id: h.id,
      owner: h.owner,
      source: h.sourceId,
      order: i,
      fields: [category(h.axis, ['row', 'column']), h.line, h.due],
    });
  });
  s.siphons.forEach((l, i) => {
    knownKeys(l, ['id', 'sourceId', 'owner', 'fromId', 'toId'], 'Siphon');
    add('siphon', {
      id: l.id,
      owner: l.owner,
      parent: l.fromId,
      source: l.sourceId,
      target: l.toId,
      order: i,
    });
  });
  s.iceMarks.forEach((m, i) => {
    knownKeys(m, ['id', 'sourceId', 'owner', 'due', 'x', 'y'], 'IceMark');
    add('ice', {
      id: m.id,
      owner: m.owner,
      source: m.sourceId,
      order: i,
      fields: [m.x, m.y, m.due],
    });
  });
  s.pending.forEach((r, i) => {
    knownKeys(r, ['kind', 'targetId', 'owner', 'source', 'amount'], 'Reaction');
    const id = `reaction:${i}`;
    add('reaction', {
      id,
      owner: r.owner,
      source: r.source.id,
      target: r.targetId,
      order: i,
      fields: [category(r.kind, REACTIONS), r.amount],
    });
    unit(r.source, 'snapshot', id);
  });
  if (s.auras) knownKeys(s.auras, ['1', '2'], 'auras');
  if (s.clockFrames) knownKeys(s.clockFrames, ['1', '2'], 'clockFrames');
  for (const p of sides) {
    s.auras?.[p].forEach((a, i) => {
      knownKeys(a, ['kind', 'parity', 'usedPly'], 'Aura');
      add('aura', {
        kind: a.kind,
        owner: p,
        order: i,
        fields: [category(a.parity, ['odd', 'even']), a.usedPly],
      });
    });
    const frames = s.clockFrames?.[p];
    if (frames) knownKeys(frames, ['current', 'previous'], 'ClockFrames');
    for (const [i, name] of (['current', 'previous'] as const).entries()) {
      const frame = frames?.[name];
      if (!frame) continue;
      knownKeys(frame, ['ply', 'turns', 'units'], 'ClockFrame');
      knownKeys(frame.turns, ['1', '2'], 'ClockFrame.turns');
      const id = `frame:${p}:${name}`;
      add('frame', {
        id,
        owner: p,
        order: i,
        fields: [frame.ply, frame.turns[viewer], frame.turns[other(viewer)]],
      });
      frame.units.forEach((u, j) => unit(u, 'snapshot', id, j));
    }
  }
  const draft = s.shrineDraft;
  if (draft) {
    knownKeys(draft, ['offers', 'committed', 'choices', 'revealed'], 'ShrineDraft');
    for (const pair of [draft.offers, draft.committed, draft.choices])
      knownKeys(pair, ['1', '2'], 'ShrineDraft玩家记录');
    ensure(
      draft.revealed || draft.choices[other(viewer)] === undefined,
      '编码输入泄露尚未揭示的对方神龛选择。',
    );
    for (const p of sides) {
      draft.offers[p].forEach((kind, i) => add('draft-offer', { kind, owner: p, order: i }));
      const choice = draft.choices[p];
      if (choice) {
        knownKeys(choice, ['kind', 'parity'], 'ShrineChoice');
        add('draft-choice', {
          kind: choice.kind,
          owner: p,
          fields: [category(choice.parity, ['odd', 'even'])],
        });
      }
    }
  }
  if (s.summonOffer) {
    knownKeys(s.summonOffer, ['owner', 'groups', 'count'], 'SummonOffer');
    for (const [i, group] of s.summonOffer.groups.entries())
      group.forEach((c, j) => card(c, s.summonOffer!.owner, 'summon-offer', `offer:${i}`, j));
  }
  if (prefix) {
    add('prefix', {
      id: 'prefix',
      owner: viewer,
      source: prefix.unitId ?? prefix.cardId,
      target: prefix.targetId,
      fields: [
        category(prefix.type, COMMANDS),
        category(prefix.mode, MODES),
        prefix.x,
        prefix.y,
        prefix.row,
        prefix.column,
        prefix.ultimate,
        prefix.charge,
        category(prefix.direction, DIRECTIONS),
        prefix.ability === undefined ? undefined : kindIndex(prefix.ability),
        prefix.chosenKind === undefined ? undefined : kindIndex(prefix.chosenKind),
        prefix.shrineKind === undefined ? undefined : kindIndex(prefix.shrineKind),
        category(prefix.parity, ['odd', 'even']),
        prefix.recipeId === undefined
          ? undefined
          : category(
              prefix.recipeId,
              SYNTHESIS_RECIPES.map((r) => r.id),
            ),
        prefix.player === undefined ? undefined : owner(prefix.player),
      ],
    });
    for (const [field, ids] of [
      ['secondId', prefix.secondId ? [prefix.secondId] : []],
      ['deathId', prefix.deathId ? [prefix.deathId] : []],
      ['materialIds', prefix.materialIds ?? []],
      ['cardIds', prefix.cardIds ?? []],
      ['sacrificeIds', prefix.sacrificeIds ?? []],
    ] as const)
      ids.forEach((id, i) =>
        add('argument', {
          parent: 'prefix',
          target: id,
          order: i,
          fields: [
            category(field, ['secondId', 'deathId', 'materialIds', 'cardIds', 'sacrificeIds']),
          ],
        }),
      );
    prefix.path?.forEach((p, i) => add('path', { parent: 'prefix', order: i, fields: [p.x, p.y] }));
    prefix.offerIndices?.forEach((n, i) =>
      add('argument', { parent: 'prefix', order: i, fields: [6, n] }),
    );
  }
  const globals = [
    viewer / 2,
    owner(s.active),
    ...PHASES.map((phase) => Number(s.phase === phase)),
    Number(s.mode === 'shrine'),
    numeric(s.ply),
    numeric(s.summonSlots),
    numeric(s.turns[viewer]),
    numeric(s.turns[other(viewer)]),
    numeric(s.bases[viewer]),
    numeric(s.bases[other(viewer)]),
    numeric(s.heads[viewer]),
    numeric(s.heads[other(viewer)]),
    numeric(s.bonus[viewer]),
    numeric(s.bonus[other(viewer)]),
    numeric(s.regularSummons ?? 0),
    s.winner === undefined || s.winner === 'draw' ? 0 : owner(s.winner),
    Number(s.winner !== undefined),
    numeric(s.pending.length),
    numeric(s.hands[viewer].length),
    numeric(s.hands[other(viewer)].length),
    Number(s.shrineSetupDone?.includes(viewer) ?? false),
    Number(s.shrineSetupDone?.includes(other(viewer)) ?? false),
    Number(draft?.committed[viewer] ?? false),
    Number(draft?.committed[other(viewer)] ?? false),
    Number(draft?.revealed ?? false),
    numeric(s.summonOffer?.count ?? 0),
    s.summonOffer ? owner(s.summonOffer.owner) : 0,
    Number(prefix !== undefined),
  ];
  ensure(globals.length === 32, '全局编码长度发生变化。');
  return { entities, kinds, globals, indices, reference };
}
