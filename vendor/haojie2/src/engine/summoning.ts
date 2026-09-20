import { hasTrait } from './traits';
import { SUMMON_POOL, ULTIMATE_POOL } from './catalog';
import { now, passive } from './state';
import type { Card, Command, GamePosition, Unit } from './types';

/** Explicit on new draws; the fallback keeps pre-existing v2 saves usable. */
export function summonPool(card: Card): 'normal' | 'ultimate' | undefined {
  if (card.summonPool) return card.summonPool;
  if (SUMMON_POOL.includes(card.kind) || card.kind === '3p' || card.kind === '17p') return 'normal';
  if (ULTIMATE_POOL.includes(card.kind) || card.kind === 'u12p') return 'ultimate';
}
export function canRerollWith(s: GamePosition, mage: Unit) {
  return (
    hasTrait(mage, 'u13') &&
    mage.owner === s.active &&
    passive(s, mage) &&
    (mage.rerollUsedPly === undefined
      ? mage.freeUsed !== now(s, mage)
      : mage.rerollUsedPly !== s.ply)
  );
}
/** One rule-owned option list for engine validation, all AI levels and both UI entry points. */
export function rerollCommands(s: GamePosition, card: Card): Command[] {
  if (
    ['synthesis', 'shrine-draft', 'shrine-setup'].includes(s.phase) ||
    s.summonOffer ||
    s.winner ||
    s.pending.length ||
    s.summonSlots !== 0 ||
    card.summonedPly !== s.ply ||
    !s.hands[s.active].some((c) => c.id === card.id) ||
    !summonPool(card) ||
    (card.group && s.hands[s.active].filter((c) => c.group === card.group).length !== 8)
  )
    return [];
  const commands: Command[] = [];
  if (card.kind === 'u13' && s.turns[s.active] <= 5 && !card.rerolled)
    commands.push({ type: 'reroll', cardId: card.id });
  for (const mage of s.units
    .filter((u) => canRerollWith(s, u))
    .sort((a, b) => a.deployedAt - b.deployedAt))
    commands.push({ type: 'reroll', cardId: card.id, unitId: mage.id });
  return commands;
}
export function summonRerolls(s: GamePosition) {
  const groups = new Set<string>();
  return s.hands[s.active].flatMap((card) => {
    if (card.group && groups.has(card.group)) return [];
    if (card.group) groups.add(card.group);
    const commands = rerollCommands(s, card);
    return commands.length ? [{ card, commands, pool: summonPool(card)! }] : [];
  });
}
