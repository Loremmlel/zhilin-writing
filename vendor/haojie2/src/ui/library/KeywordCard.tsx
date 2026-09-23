import { definition, keywordDefinition, type GamePosition, type KeywordId } from '../../engine';
import { unitStatus } from '../inspector/unit-status';
import { RuleText, UnitLink, type StatusContext } from './UnitReference';

/** 说明来自规则目录；实例信息每次从最新公开局面重算，不缓存数值或持有历史棋子对象。 */
export function KeywordCard({
  id,
  state,
  context,
}: {
  id: KeywordId;
  state?: GamePosition;
  context?: StatusContext;
}) {
  const d = keywordDefinition(id);
  const unit =
    context && state
      ? [...state.units, ...(state.landmarks ?? [])].find((u) => u.id === context.unitId)
      : undefined;
  const row =
    unit && state && context
      ? unitStatus(state, unit).find(
          (entry) => entry.key === context.statusKey && entry.keywords?.includes(id),
        )
      : undefined;
  return (
    <article className="codex-card keyword-card">
      <div className="codex-card-heading">
        <div>
          <span className="piece-index">状态与特性 · {d.category}</span>
          <h3>{d.name}</h3>
        </div>
      </div>
      <p>
        <RuleText excludeKeyword={id} references={{ 金身: 'immune', 心灵之火: 'inner-fire' }}>
          {d.description}
        </RuleText>
      </p>
      {context && (
        <section className="keyword-instance" aria-label="本次状态" aria-live="polite">
          <h4>
            本次状态
            {unit && (
              <>
                {' '}
                · <UnitLink kind={unit.kind}>{definition(unit.kind).name}</UnitLink>
              </>
            )}
          </h4>
          {row ? (
            <>
              <p>
                {row.pending ? '待生效' : '当前记录'} · {row.label}
              </p>
              <p>
                <RuleText excludeKeyword={id}>{row.detail}</RuleText>
              </p>
            </>
          ) : (
            <p>该状态已结束或棋子已离场。以上通用规则仍可查阅。</p>
          )}
        </section>
      )}
      <footer className="keyword-sources">
        <h4>相关单位与装备</h4>
        <p>
          {d.sources.map((kind, index) => (
            <span key={kind}>
              {index > 0 && '、'}
              <UnitLink kind={kind}>{definition(kind).name}</UnitLink>
            </span>
          ))}
        </p>
      </footer>
    </article>
  );
}
