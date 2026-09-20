import type { GameEvent } from '../../engine';
import { Icon } from '../shared/visuals';

export function Feedback({
  events,
  notice,
  onDismiss,
}: {
  events: GameEvent[];
  notice: string;
  onDismiss: () => void;
}) {
  const reveals = events.filter((e) => e.type === 'summon');
  return (
    <>
      {reveals.length > 0 && (
        <div
          className={`summon-reveal ${reveals.some((e) => e.ultimate) ? 'ultimate-reveal' : ''}`}
          role="status"
        >
          <span>{reveals.some((e) => e.ultimate) ? 'ULTIMATE SUMMON' : 'SUMMON'}</span>
          <Icon name="spark" size={28} />
          <strong>{reveals.map((e) => e.text).join(' · ')}</strong>
        </div>
      )}
      {notice && (
        <div className="toast" role="status">
          <Icon name="help" size={18} />
          <p>{notice}</p>
          <button className="icon-button" aria-label="关闭提示" onClick={() => onDismiss()}>
            <Icon name="x" size={16} />
          </button>
        </div>
      )}
    </>
  );
}
