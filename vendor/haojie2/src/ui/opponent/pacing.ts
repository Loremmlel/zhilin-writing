import type { Command, GameEvent } from '../../engine';

/** 仅控制展示节奏，不改变搜索预算、游戏时钟或保存的随机状态。 */
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

/** 命令执行前的最小可见间隔；缓存计划同样遵守。 */
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

  // 替换前让现有命中、生命数值、召唤揭示或移动效果完成必要展示。
  // 即使只是无效果的模式切换，也不能立刻清空上一动作特效。
  const visualFloor = events.reduce((hold, event) => {
    if (['attack', 'damage', 'heal', 'death'].includes(event.type)) return Math.max(hold, 1400);
    if (event.type === 'summon') return Math.max(hold, 1500);
    if (event.type === 'skill' || event.type === 'shield') return Math.max(hold, 1200);
    if (event.type === 'move' || event.type === 'spawn') return Math.max(hold, 650);
    return hold;
  }, 0);
  return Math.max(delay, visualFloor, first ? CADENCE.first : 0);
}

/** 可取消地等待尚未被实际计算时间覆盖的剩余展示间隔。 */
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
