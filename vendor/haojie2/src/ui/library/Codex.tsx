import { useState } from 'react';
import { CATALOG } from '../../engine';
import { DefinitionStats } from '../shared/DefinitionStats';
import { Modal } from '../shared/Modal';
import { Icon, Rune } from '../shared/visuals';
export function Codex({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState(''),
    [filter, setFilter] = useState('全部');
  const entries = CATALOG.filter((d) => {
    const match =
      filter === '全部' ||
      (filter === '神龛' && d.tier === 'shrine') ||
      (filter === '光环' && d.aura) ||
      (filter === '地标' && d.landmark) ||
      (filter === '普通' && d.tier === 'normal') ||
      (filter === '终极' && d.tier === 'ultimate') ||
      (filter === '法术' && d.spell !== undefined) ||
      (filter === '武器' && d.weapon !== undefined) ||
      (filter === '变体' && d.tier === 'derived');
    return (
      match &&
      `${d.name}${d.id}${d.description}${d.role}`.toLowerCase().includes(query.trim().toLowerCase())
    );
  });
  return (
    <Modal
      title="浩劫图鉴"
      subtitle="26种普通召唤、28种终极召唤、16种神龛，以及变体与合成。第四属性现为选择攻击后的攻击次数。"
      wide
      onClose={onClose}
    >
      <div className="codex-tools">
        <label className="search-field">
          <Icon name="target" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索名称、能力或编号…"
            aria-label="搜索图鉴"
          />
          <span>{entries.length}</span>
        </label>
        <div className="filter-tabs">
          {['全部', '普通', '终极', '神龛', '地标', '光环', '法术', '武器', '变体'].map((f) => (
            <button
              key={f}
              aria-pressed={f === filter}
              className={f === filter ? 'active' : ''}
              onClick={() => setFilter(f)}
            >
              {f}
            </button>
          ))}
        </div>
      </div>
      <div className="codex-grid">
        {entries.map((d) => (
          <article
            key={d.id}
            className={`codex-card ${d.spell !== undefined ? 'is-spell' : ''} ${d.tier === 'ultimate' ? 'ultimate-codex' : ''} ${d.weapon !== undefined ? 'is-weapon' : ''}`}
          >
            <div className="codex-card-heading">
              <Rune kind={d.id} large />
              <div>
                <span className="piece-index">
                  {d.tier === 'normal'
                    ? `普通 ${String(d.id).padStart(2, '0')}`
                    : d.tier === 'ultimate'
                      ? `终极 ${String(d.id).slice(1).padStart(2, '0')}`
                      : d.tier === 'shrine'
                        ? `神龛 ${String(d.id).slice(1)}`
                        : '变体 / 合成'}
                </span>
                <h3>{d.name}</h3>
                <span className="role-chip">
                  {d.role}
                  {d.mage ? ' · 法师' : ''}
                  {d.size ? ' · 2×2' : ''}
                </span>
              </div>
            </div>
            <DefinitionStats d={d} />
            <p>{d.description}</p>
            {d.skill && (
              <div className="skill-label">
                <Icon name="spark" size={14} />
                {d.skill}
              </div>
            )}
          </article>
        ))}
      </div>
      {entries.length === 0 && (
        <p className="empty-state">没有匹配条目。可以搜索“冰冻”“人头”“复活”或“法师”。</p>
      )}
      <p className="fine-print">
        图鉴与引擎共用定义。神龛只在独立神龛模式开局抽取；牢千K由3名终极13合成，两个模式均可使用。
      </p>
    </Modal>
  );
}
