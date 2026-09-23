/** 纯攻击随机分布，命令引擎仍是唯一战斗结算者。分支顺序与概率分界保持历史 PRNG 映射，包括吸血鬼必定暴击的情况。 */
import { COMBAT_RULES as rules } from '../catalog';
import type { Kind } from '../types';
export interface DamagePacket {
  damage: number;
  probability: number;
}
export const vampireRate = (kills: number) => rules.vampire.base + rules.vampire.perKill * kills;
export function attackProfile(
  kind: Kind,
  attack: number,
  kills: number,
  silenced: boolean,
  base: boolean,
): { packets: DamagePacket[]; cuts?: number[] } {
  if (silenced) return { packets: [{ damage: attack, probability: 1 }] };
  if (kind === 1) {
    const r = rules.charger;
    return {
      cuts: [0, r.heavyChance, r.criticalChance, 1],
      packets: [
        { damage: attack + r.heavyBonus, probability: r.heavyChance },
        { damage: attack + r.bonus, probability: r.criticalChance - r.heavyChance },
        { damage: attack, probability: 1 - r.criticalChance },
      ],
    };
  }
  if (kind === 'u1') {
    const r = rules.superCritical,
      doubleEnd = r.lethalChance + r.doubleChance;
    return {
      cuts: [0, r.lethalChance, doubleEnd, 1],
      packets: [
        { damage: r.lethalDamage, probability: r.lethalChance },
        { damage: attack * 2, probability: r.doubleChance },
        { damage: attack, probability: 1 - doubleEnd },
      ],
    };
  }
  if (kind === 'u8') {
    const p = Math.min(1, vampireRate(kills));
    return {
      cuts: [0, p, 1],
      packets: [
        { damage: attack * 2, probability: p },
        { damage: attack, probability: 1 - p },
      ],
    };
  }
  return {
    packets: [{ damage: kind === 'u27' && base ? rules.minerBaseDamage : attack, probability: 1 }],
  };
}

export function combinedAttackPackets(
  kinds: readonly Kind[],
  attack: number,
  kills: number,
  silenced: boolean,
  base: boolean,
): DamagePacket[] {
  let result: DamagePacket[] = [{ damage: attack, probability: 1 }];
  for (const kind of kinds)
    result = result.flatMap((p) =>
      attackProfile(kind, p.damage, kills, silenced, base).packets.map((q) => ({
        damage: q.damage,
        probability: p.probability * q.probability,
      })),
    );
  return result;
}
