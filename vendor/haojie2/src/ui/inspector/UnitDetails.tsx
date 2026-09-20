import type { GamePosition, Unit } from '../../engine';
import { getStats, definition, abilityKinds } from '../../engine';
import { UnitStatus } from './UnitStatus';
import { Icon, numberLabel } from '../shared/visuals';

export function UnitDetails({ state: s, unit: inspected }: { state: GamePosition; unit: Unit }) {
  const modeNames: Record<string, string> = {
    none: '尚未选择',
    move: '移动模式',
    attack: '攻击模式',
    skill: '技能模式',
    charge: '蓄力模式',
  };

  const stats = getStats(s, inspected);
  return (
    <>
      {definition(inspected.kind).landmark && (
        <p className="shrine-status" role="status">
          {(inspected as import('../../engine').Landmark).dormantSince !== undefined
            ? `地标休眠 · 重建还需${Math.max(0, definition(inspected.kind).landmark!.rebuild - ((inspected as import('../../engine').Landmark).rebuildTicks ?? 0))}个己方回合。到期后，敌方或中立占位会阻止重建。`
            : '地标生效 · 可与一个棋子同格，点击同格可切换查看。'}
        </p>
      )}
      {abilityKinds(inspected).length > 1 && (
        <section className="ability-details">
          <h4>强夺获得的能力 · {abilityKinds(inspected).length - 1}</h4>
          {abilityKinds(inspected)
            .filter((k) => k !== inspected.kind)
            .map((k) => (
              <p key={k}>
                <b>{definition(k).name}</b>：{definition(k).description}
              </p>
            ))}
        </section>
      )}
      <>
        <div className="live-stats">
          {[
            ['sword', '攻击', Math.round(stats.attack * 10) / 10],
            ['heart', '生命', `${Math.round(inspected.hp * 10) / 10}/${inspected.maxHp}`],
            [
              'target',
              '射程',
              inspected.kind === 'formless' || inspected.kind === 's7' ? '∞' : stats.range,
            ],
            ['clock', '攻击次数', stats.actions],
            ['move', '移动', numberLabel(stats.move)],
          ].map(([icon, label, value]) => (
            <div key={label}>
              <span>
                <Icon name={String(icon)} size={13} />
                {label}
              </span>
              <b>{value}</b>
            </div>
          ))}
        </div>
        <div className="operation-state">
          <span>
            {modeNames[inspected.mode]}
            {stats.sleeping ? ' · 休整中' : ''}
          </span>
          <b>
            操作 {stats.operationsLeft}/{stats.operationLimit}
          </b>
        </div>
        {inspected.mode === 'attack' && (
          <p className="sequence-hint">本次攻击还剩 {stats.remaining} 次，不能切换移动或技能。</p>
        )}
        {inspected.mode === 'move' && inspected.moves > 0 && (
          <p className="sequence-hint">
            {inspected.size > 1 ? '整体移动' : '冲撞'}还剩 {inspected.moves}{' '}
            步；每次一小格，最终不得重叠。
          </p>
        )}
      </>
      <>
        <UnitStatus state={s} unit={inspected} />
        {inspected.charge > 0 && (
          <div className="charge-meter">
            <span>
              {inspected.chargeType === 'move'
                ? '移动'
                : inspected.chargeType === 'skill'
                  ? '技能'
                  : '攻击'}
              蓄力{' '}
              <b>
                {inspected.charge} 层 · 就绪 {inspected.readyCharge}
              </b>
            </span>
            <div>
              {Array.from(
                {
                  length:
                    inspected.kind === 4
                      ? 5
                      : inspected.kind === 'u2' || inspected.kind === 15
                        ? 4
                        : inspected.kind === 21
                          ? 2
                          : 1,
                },
                (_, i) => (
                  <i key={i} className={i < inspected.charge ? 'filled' : ''} />
                ),
              )}
            </div>
          </div>
        )}
      </>
    </>
  );
}
