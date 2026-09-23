import { UnitText } from '../library/UnitReference';
import type { GamePosition } from '../../engine';
import { Icon } from '../shared/visuals';

export function BattleLog({
  state: s,
  saveStatus,
  onOpen,
}: {
  state: GamePosition;
  saveStatus: string;
  onOpen: () => void;
}) {
  return (
    <section className="panel battle-log">
      <div className="panel-heading">
        <h2>战场纪事</h2>
        <button className="text-button" onClick={() => onOpen()}>
          全部
          <Icon name="arrow" size={13} />
        </button>
      </div>
      <ol>
        {s.log
          .slice(-5)
          .reverse()
          .map((line, i) => (
            <li key={`${i}-${line}`}>
              <i />
              <p>
                <UnitText>{line.split('·').slice(1).join('·').trim()}</UnitText>
              </p>
            </li>
          ))}
      </ol>
      <div className="log-footer">
        <i className="live-dot" />
        {saveStatus}
      </div>
    </section>
  );
}
