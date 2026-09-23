import {
  activeEffect,
  effectKeyword,
  keywordDefinition,
  canCounterSpell,
  attackAuraSources,
  COMBAT_RULES,
  asTarget,
  attackPath,
  cells,
  definition,
  effectClock,
  getStats,
  guardProtections,
  now,
  passive,
} from '../../engine';
import type { GamePosition, KeywordId, Unit } from '../../engine';

export interface StatusEntry {
  key: string;
  label: string;
  detail: string;
  pending?: boolean;
  keywords?: readonly KeywordId[];
}
/** 只读展示；到期时间、保护来源与射程均来自引擎。 */
export function unitStatus(s: GamePosition, u: Unit): StatusEntry[] {
  const rows: StatusEntry[] = [];
  const effectOccurrences = new Map<string, number>();
  const sourceLabel = (id?: string) => {
    const source = [...s.units, ...(s.landmarks ?? [])].find((v) => v.id === id);
    return source
      ? `${definition(source.kind).name} (${source.x},${source.y})`
      : id
        ? '来源已离场'
        : '记录未保存来源';
  };
  for (const e of u.effects) {
    const clock = effectClock(s, e, u);
    if (e.until <= clock) continue;
    // 状态没有规则 ID，用不可变字段及同值重复序号定位；其他效果移除后不会串到另一条状态。
    const identity = JSON.stringify([
      e.type,
      e.from,
      e.until,
      e.owner,
      e.amount,
      e.sourceId,
      !!e.global,
    ]);
    const occurrence = effectOccurrences.get(identity) ?? 0;
    effectOccurrences.set(identity, occurrence + 1);
    const pending = !activeEffect(s, e, u);
    const timing = pending
      ? e.global && (e.type === 'execute' || e.type === 'convert')
        ? '下个己方回合生效；冲锋号令不能提前'
        : `待生效 · 还需推进 ${e.from - clock} 次回合计时`
      : `生效中 · 余 ${e.until - clock} 次${e.global ? '实际回合切换' : '本棋子回合计时'}`;
    const rule =
      e.type === 'execute'
        ? '首次命中敌方时消耗，绕过名刀'
        : e.type === 'convert'
          ? '攻击实际扣血才触发；目标需存活且可策反'
          : e.type === 'attack'
            ? `攻击 ${(e.amount ?? 0) >= 0 ? '+' : ''}${e.amount ?? 0}`
            : e.type === 'inner-fire'
              ? '攻击力等于当前生命'
              : e.type === 'mark'
                ? `同阵营后续命中时，逐层独立爆炸，每层${COMBAT_RULES.catapultMarkDamage}伤害`
                : e.type === 'immune'
                  ? '免疫伤害和敌方负面效果'
                  : e.type === 'freeze'
                    ? `保持原阵营，不能行动；常驻光环/被动通常保留，万法反制暂停；双方回合结束各受${e.amount ?? 5}伤害`
                    : e.type === 'stun'
                      ? '不能行动'
                      : `双方回合结束各受${e.amount ?? 5}伤害`;
    rows.push({
      key: `effect-${identity}-${occurrence}`,
      label:
        e.type === 'execute'
          ? definition(18).name
          : e.type === 'convert'
            ? definition(22).name
            : keywordDefinition(effectKeyword(e)).name,
      keywords: [effectKeyword(e)],
      pending,
      detail: [timing, rule, `来源：${sourceLabel(e.sourceId)}`].join(' · '),
    });
  }
  for (const source of attackAuraSources(s, u))
    rows.push({
      key: `aura-${source.id}`,
      keywords: ['attack-aura'],
      label: '先师光环 · 攻击 +' + COMBAT_RULES.sageAuraAttack,
      detail: sourceLabel(source.id) + ' · 随范围与来源状态即时更新',
    });
  if (u.kind === 'formless')
    rows.push({
      key: 'half-attack',
      keywords: ['reserve'],
      label: '半速攻击 / 移动',
      detail: '需先蓄对应模式1层，下回合可用；一次攻击后可选择牵引原命中目标。',
    });
  if (u.kind === 'slayer' && passive(s, u))
    rows.push({
      key: 'slayer',
      keywords: ['piercing', 'lifesteal', 'reflect'],
      label: '穿透 · 吸血 · 反伤',
      detail: '四向直线穿透，100%攻击吸血，实际受伤50%反弹；反伤不相互反弹。',
    });
  if (u.kind === 'firelord' && !u.silenced)
    rows.push({
      key: 'judgement',
      label: '末日审判 · 己方回合末',
      detail: '13×13范围最高血敌方80伤，命中格四向只对敌方溅射10；无法主动攻击。',
    });
  if (u.kind === 'archmage')
    rows.push({
      key: 'counter',
      keywords: ['counter'],
      label: '万法反制',
      detail: canCounterSpell(s, u)
        ? '2/3概率反制敌方法术；成功生命上限与当前生命+15。'
        : '沉默或冰冻中，不参与反制。',
    });
  if (u.kind === 'citadel')
    rows.push({
      key: 'citadel',
      label: '王城死亡召唤',
      detail: '范围内每枚友方死亡分别触发；包括召唤物，选择合法落点支付10生命上限。',
    });
  const guards = guardProtections(s, u);
  if (guards.length)
    rows.push({
      key: 'guards',
      keywords: ['guard'],
      label: `名刀保护 · 剩余 ${guards.filter((g) => !g.used).length} 次`,
      detail: guards
        .map(
          ({ source, used }, index) =>
            `${index + 1}. (${source.x},${source.y}) ${used ? '已消耗' : '可用'}`,
        )
        .join('；'),
    });
  else if (u.guardUsed)
    rows.push({
      key: 'guards',
      keywords: ['guard'],
      label: '名刀保护 · 剩余 0 次',
      detail: '已消耗来源不会恢复；当前没有可用的名刀来源。',
    });
  for (const tower of s.units) {
    if (
      tower.kind === 'u15' &&
      tower.owner === u.owner &&
      passive(s, tower) &&
      attackPath(s, tower, asTarget(u), getStats(s, tower).range)
    )
      rows.push({
        key: `tower-${tower.id}`,
        keywords: ['protection'],
        label: '免疫塔保护',
        detail: `${sourceLabel(tower.id)} · 阻挡敌方法术或技能时由来源支付生命上限`,
      });
  }
  for (const link of s.siphons) {
    if (link.fromId === u.id || link.toId === u.id)
      rows.push({
        key: `link-${link.id}`,
        keywords: ['siphon'],
        label: link.fromId === u.id ? '灵魂虹吸 · 扣血端' : '灵魂虹吸 · 治疗端',
        detail: `${sourceLabel(link.sourceId)} · 回合结束结算，连接中断后停止`,
      });
  }
  for (const hazard of s.hazards) {
    if (cells(u).some((p) => (hazard.axis === 'row' ? p.y : p.x) === hazard.line))
      rows.push({
        key: `hazard-${hazard.id}`,
        label: '烈焰风暴 · 延迟区域',
        pending: true,
        detail: `所在${hazard.axis === 'row' ? '行' : '列'}将再次受击 · 余 ${Math.max(0, hazard.due - s.ply)} 次实际回合切换`,
      });
  }
  for (const mark of s.iceMarks) {
    if (cells(u).some((p) => p.x === mark.x && p.y === mark.y))
      rows.push({
        key: `ice-${mark.id}`,
        keywords: ['freeze'],
        label: '寒冰标记格',
        pending: true,
        detail: `${sourceLabel(mark.sourceId)} · 延迟冻结区域`,
      });
  }
  for (const kind of u.equipment)
    rows.push({
      key: `equipment-${kind}`,
      label: `装备 · ${definition(kind).name}`,
      detail: definition(kind).description,
    });
  if (u.silenced)
    rows.push({
      key: 'silence',
      keywords: ['silence'],
      label: '原技能已沉默',
      detail: '原有主动技能与对应被动能力失效；装备效果保留。',
    });
  if (u.attackBonus || u.rangeBonus)
    rows.push({
      key: 'permanent',
      label: '属性调整',
      detail: `额外攻击 ${u.attackBonus >= 0 ? '+' : ''}${u.attackBonus} · 额外射程 +${u.rangeBonus}`,
    });
  if (u.size > (definition(u.kind).size ?? 1))
    rows.push({
      key: 'size',
      keywords: ['giant'],
      label: '巨大化',
      detail: '当前占用 2×2 格，移动与部署按完整体型判断。',
    });
  if (u.bonusAttacks)
    rows.push({
      key: 'bonus',
      keywords: ['extra-attack'],
      label: '额外攻击操作',
      detail: `本回合还可使用 ${u.bonusAttacks} 次`,
    });
  if (u.kind === 'u13')
    rows.push({
      key: 'reroll',
      label: '改判次数',
      detail:
        u.rerollUsedPly === s.ply || (u.rerollUsedPly === undefined && u.freeUsed === now(s, u))
          ? '本实际回合已使用 · 冲锋号令不刷新'
          : '本实际回合尚未使用；轮到己方且能力未失效时可改判',
    });
  if (u.hookReadyAt !== undefined)
    rows.push({
      key: 'hook',
      label: '黑洞牵引',
      pending: now(s, u) < u.hookReadyAt,
      detail: now(s, u) < u.hookReadyAt ? '等待冷却' : '冷却已完成；仍需满足技能范围与行动条件',
    });
  if (u.kills) rows.push({ key: 'kills', label: '击杀记录', detail: `已击杀 ${u.kills} 名敌方` });
  return rows;
}
