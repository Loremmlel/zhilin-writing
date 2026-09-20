import type { Command, GameEvent } from '../../engine';

/** Presentation time only: never changes search budgets, game clocks or the saved RNG. */
const CADENCE = {
  first: 1500,
  action: 1100,
  followUp: 750,
  spell: 1350,
  summon: 1200,
  end: 1000,
  housekeeping: 250,
};
interface Context {
  first: boolean;
  previous: Command | null;
  events: readonly GameEvent[];
}

/** Minimum visible interval before a command. Cached plans must use the same cadence. */
export function actionDelay(command: Command, { first, previous, events }: Context): number {
  let delay: number = CADENCE.action;
  const sameUnit = !!command.unitId && command.unitId === previous?.unitId;
  if (
    (sameUnit && command.type === previous?.type) ||
    (command.type === 'deploy' && previous?.type === 'deploy')
  )
    delay = CADENCE.followUp;
  if (['cast', 'skill', 'equip', 'craft', 'synthesize', 'charge', 'reroll'].includes(command.type))
    delay = CADENCE.spell;
  if (command.type === 'summon') delay = CADENCE.summon;
  if (command.type === 'end') delay = CADENCE.end;
  if (
    command.type === 'begin' ||
    command.type === 'skip-synthesis' ||
    command.type === 'finish-mode'
  )
    delay = CADENCE.housekeeping;

  // Let an existing hit/health number, summon reveal or movement settle before replacing it.
  // Even a no-op mode transition must not immediately clear the previous action's effects.
  const visualFloor = events.reduce((hold, event) => {
    if (['attack', 'damage', 'heal', 'death'].includes(event.type)) return Math.max(hold, 1400);
    if (event.type === 'summon') return Math.max(hold, 1500);
    if (event.type === 'skill' || event.type === 'shield') return Math.max(hold, 1200);
    if (event.type === 'move' || event.type === 'spawn') return Math.max(hold, 650);
    return hold;
  }, 0);
  return Math.max(delay, visualFloor, first ? CADENCE.first : 0);
}

/** Cancellable wait for only the time not already spent computing the actual decision. */
export function waitForPresentation(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const aborted = () => new DOMException('AI行动等待已取消', 'AbortError');
    if (signal.aborted) {
      reject(aborted());
      return;
    }
    const cancel = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      reject(aborted());
    };
    const timer = setTimeout(
      () => {
        signal.removeEventListener('abort', cancel);
        resolve();
      },
      Math.max(0, milliseconds),
    );
    signal.addEventListener('abort', cancel, { once: true });
  });
}
