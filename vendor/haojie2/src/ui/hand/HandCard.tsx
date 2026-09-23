import type { Card, Player } from '../../engine';
import { definition, isStored } from '../../engine';
import { Icon, Rune } from '../shared/visuals';

export function HandCard({
  card: c,
  owner,
  turn,
  selected,
  disabled,
  onChoose,
}: {
  card: Card;
  owner: Player;
  turn: number;
  selected: boolean;
  disabled: boolean;
  onChoose: (id: string) => void;
}) {
  const cd = definition(c.kind),
    limit = c.expiresAt === undefined ? null : c.expiresAt - turn;
  return (
    <button
      key={c.id}
      className={`hand-card ${cd.spell !== undefined ? 'spell-card' : ''} ${cd.weapon !== undefined ? 'weapon-card' : ''} ${cd.tier === 'ultimate' || c.kind === 'firelord' || c.kind === 'u12p' ? 'ultimate-card' : ''} ${selected ? 'chosen' : ''}`}
      aria-label={`选择${cd.name}${cd.weapon !== undefined ? '武器' : cd.spell !== undefined ? '法术' : '随从'}`}
      aria-pressed={selected}
      disabled={disabled}
      onClick={() => onChoose(c.id)}
    >
      <Rune kind={c.kind} owner={owner} />
      <div className="hand-card-main">
        <div>
          <h3>{cd.name}</h3>
        </div>
        {isStored(cd) ? (
          <p className={limit === 1 ? 'expires-soon' : ''}>
            <Icon name={cd.weapon !== undefined ? 'sword' : 'clock'} size={12} />
            {limit === null
              ? '储限未注明 · 暂不限'
              : limit === 1
                ? '本回合到期'
                : `剩余${limit}回合`}
          </p>
        ) : (
          <p>
            <span>
              <Icon name="sword" size={11} />
              {cd.attack}
            </span>
            <span>
              <Icon name="heart" size={11} />
              {cd.health}
            </span>
            <span>
              <Icon name="target" size={11} />
              {cd.range}
            </span>
          </p>
        )}
      </div>
      {!isStored(cd) && <span className="deploy-label">{c.group ? '同批克隆 · ' : ''}待部署</span>}
    </button>
  );
}
