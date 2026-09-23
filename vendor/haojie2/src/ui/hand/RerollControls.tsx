import type { Command, GamePosition } from '../../engine';
import { definition, summonRerolls } from '../../engine';

/** 规则选项同时驱动卡牌操作与 AI；展开说明不消耗资源。 */
export function RerollControls({
  state,
  run,
  readOnly,
}: {
  state: GamePosition;
  run: (command: Command) => void;
  readOnly: boolean;
}) {
  const choices = summonRerolls(state);
  if (!choices.length) return null;
  const mages = new Set(
    choices.flatMap(({ commands }) => commands.flatMap((c) => (c.unitId ? [c.unitId] : []))),
  );
  const self = choices.filter(({ commands }) => commands.some((c) => !c.unitId)).length;
  return (
    <section className="reroll-controls" aria-label="召唤改判">
      <p>召唤次数已用完，是否改判？</p>
      <small>
        场上法师剩余 {mages.size} 次{self > 0 ? ` · 可重铸自身 ${self} 张` : ''}
        。替换后从原卡池自动召唤，不再扣人头。
      </small>
      <details>
        <summary>是，选择召唤结果</summary>
        <div className="reroll-results">
          {choices.map(({ card, commands, pool }) => {
            const command = commands[0];
            const mage = state.units.find((u) => u.id === command.unitId);
            return (
              <button
                key={card.id}
                className="secondary"
                disabled={readOnly}
                onClick={() => run(command)}
              >
                <span>
                  改判 {definition(card.kind).name}
                  {card.group ? ' ×8' : ''}
                </span>
                <small>
                  {pool === 'ultimate' ? '终极池' : '普通池'} ·{' '}
                  {mage ? `使用 (${mage.x},${mage.y}) 的法师` : '重铸自身'}
                </small>
              </button>
            );
          })}
        </div>
        <small>场上法师按入场先后使用；手牌详情中也可指定法师。取消选择只需收起此栏。</small>
      </details>
      <small>
        {state.phase === 'summon'
          ? '不改判可直接点击下方“完成召唤，开始行动”。'
          : '不改判可继续部署或行动。'}
      </small>
    </section>
  );
}
