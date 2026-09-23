import { UnitText, RuleText, KeywordLink } from '../library/UnitReference';
import type { GamePosition, Unit } from '../../engine';
import { unitStatus } from './unit-status';

export function UnitStatus({ state, unit }: { state: GamePosition; unit: Unit }) {
  const rows = unitStatus(state, unit);
  return (
    <details className="unit-status" aria-label="棋子当前状态">
      <summary>当前状态 · {rows.length}项</summary>
      {rows.length ? (
        <ul>
          {rows.map((row) => (
            <li key={row.key} className={row.pending ? 'upcoming' : undefined}>
              <b>
                {row.pending ? '待生效 · ' : ''}
                {row.keywords?.length === 1 ? (
                  <KeywordLink
                    id={row.keywords[0]}
                    context={{ unitId: unit.id, statusKey: row.key }}
                  >
                    {row.label}
                  </KeywordLink>
                ) : row.keywords?.length ? (
                  row.keywords.map((id, index) => (
                    <span key={id}>
                      {index > 0 && ' · '}
                      <KeywordLink id={id} context={{ unitId: unit.id, statusKey: row.key }} />
                    </span>
                  ))
                ) : (
                  <UnitText>{row.label}</UnitText>
                )}
              </b>
              <span>
                <RuleText>{row.detail}</RuleText>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p>暂无持续效果、装备或外部技能影响。</p>
      )}
    </details>
  );
}
