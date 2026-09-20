import { PiecePosition } from './vfx/PiecePosition';
import { center, type EffectBatch } from './vfx/plan';
import { PieceFace } from './vfx/PieceFace';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { GamePosition, Player, Point } from '../../engine';
import {
  ALL_CELLS,
  allPieces,
  liveLandmark,
  landmarkAt,
  basePoint,
  cells,
  definition,
  distance,
  faction,
  getStats,
  targetAt,
} from '../../engine';
import type { Intent } from '../game/selection';
import {
  canChoose,
  intentTone,
  intentRoutes,
  directionArrow,
  directionLabel,
} from '../game/selection';
import { Icon, playerStyle } from '../shared/visuals';
import { Effects } from './Effects';

export function Board({
  state: s,
  intent,
  selectedId,
  onCell,
  effects = [],
}: {
  state: GamePosition;
  intent: Intent;
  selectedId: string | null;
  onCell: (p: Point) => void;
  effects?: EffectBatch[];
}) {
  const ref = useRef<HTMLDivElement>(null),
    [hover, setHover] = useState<Point | null>(null),
    [focus, setFocus] = useState<Point>({ x: 5, y: 7 }),
    [reduced, setReduced] = useState(false);
  useEffect(() => {
    const m = window.matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => setReduced(m.matches);
    change();
    m.addEventListener('change', change);
    return () => m.removeEventListener('change', change);
  }, []);
  const choices = useMemo(
    () => new Set(ALL_CELLS.filter((p) => canChoose(s, intent, p)).map((p) => `${p.x},${p.y}`)),
    [s, intent],
  );
  const routes = useMemo(() => intentRoutes(s, intent), [s, intent]);
  const owner = s.pending[0]?.owner ?? s.active,
    tone = intentTone(intent);
  const draft = intent.kind === 'select' ? intent.draft : null;
  const acting = draft?.unitId ? allPieces(s).find((u) => u.id === draft.unitId) : undefined;
  const currentCard = draft?.cardId
    ? s.hands[s.active].find((c) => c.id === draft.cardId)
    : undefined;
  const previewSize =
    draft?.type === 'deploy' && currentCard
      ? (definition(currentCard.kind).size ?? 1)
      : currentCard?.kind === 8 ||
          (intent.kind === 'select' &&
            intent.action.id.split(':')[0] === 'giant' &&
            draft?.targetId) ||
          (draft?.type === 'move' && acting?.size === 2)
        ? 2
        : 0;
  const preview = hover && previewSize && choices.has(`${hover.x},${hover.y}`) ? hover : null;
  function navigate(e: React.KeyboardEvent<HTMLButtonElement>, p: Point) {
    const dirs: Record<string, Point> = {
      ArrowUp: { x: 0, y: -1 },
      ArrowDown: { x: 0, y: 1 },
      ArrowLeft: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 },
    };
    const d = dirs[e.key];
    if (!d) return;
    e.preventDefault();
    const n = { x: Math.max(1, Math.min(9, p.x + d.x)), y: Math.max(1, Math.min(13, p.y + d.y)) };
    ref.current?.querySelector<HTMLButtonElement>(`[data-cell="${n.x},${n.y}"]`)?.focus();
  }
  const format = (n: number) => (Number.isInteger(n) ? n : Math.round(n * 10) / 10);
  return (
    <section className="board-shell" aria-label="浩劫对战棋盘" style={playerStyle(owner)}>
      <div className="board-topline">
        <span>
          <i className="live-dot" />
          {faction(owner)} ·{' '}
          {s.phase === 'shrine-draft'
            ? '秘密选神龛'
            : s.phase === 'shrine-setup'
              ? '神龛入场'
              : s.phase === 'synthesis'
                ? '合成阶段'
                : s.phase === 'summon'
                  ? '召唤阶段'
                  : '行动阶段'}
        </span>
        <span>
          9 × 13 <b>/</b> 117格
        </span>
      </div>
      <div className="board-frame">
        <div className="column-labels" aria-hidden="true">
          {Array.from({ length: 9 }, (_, i) => (
            <span key={i}>{i + 1}</span>
          ))}
        </div>
        <div className="row-labels" aria-hidden="true">
          {Array.from({ length: 13 }, (_, i) => (
            <span key={i}>{String(i + 1).padStart(2, '0')}</span>
          ))}
        </div>
        <div
          className={`board ${intent.kind !== 'none' ? 'targeting' : ''}`}
          ref={ref}
          role="grid"
          aria-label="九列十三行战场，方向键选择格子，回车操作"
          onMouseLeave={() => setHover(null)}
        >
          {Array.from({ length: 13 }, (_, row) => (
            <div role="row" className="board-row" key={row}>
              {Array.from({ length: 9 }, (_, col) => {
                const p = { x: col + 1, y: row + 1 },
                  t = targetAt(s, p),
                  stack = s.units.filter((u) => cells(u).some((c) => c.x === p.x && c.y === p.y)),
                  valid = choices.has(`${p.x},${p.y}`),
                  selected = stack.some((u) => u.id === selectedId) || t?.id === selectedId;
                const range =
                  acting &&
                  draft?.type === 'attack' &&
                  cells(acting).some((c) => distance(c, p) <= getStats(s, acting).range);
                const inPreview =
                  preview &&
                  p.x >= preview.x &&
                  p.x < preview.x + previewSize &&
                  p.y >= preview.y &&
                  p.y < preview.y + previewSize;
                const route = routes.find(
                  (r) => r.path.at(-2)!.x === p.x && r.path.at(-2)!.y === p.y,
                );
                const routeLabel = route
                  ? `，${directionLabel[route.direction]}，路径${route.path.length - 1}格`
                  : '';
                const label = `${p.x}列${p.y}行${t ? `，${faction(t.owner) + (t.unit && getStats(s, t.unit).frozen ? '，冰冻' : '')}${t.unit ? definition(t.unit.kind).name + '，' + format(t.unit.hp) + '生命' : '基地，' + s.bases[t.owner] + '生命'}` : '，空格'}${stack.length > 1 ? `，叠放${stack.length}枚` : ''}${valid ? '，可选择' : ''}`;
                return (
                  <button
                    role="gridcell"
                    key={col}
                    data-cell={`${p.x},${p.y}`}
                    aria-label={
                      label +
                      routeLabel +
                      (landmarkAt(s, p)
                        ? `，地标${definition(landmarkAt(s, p)!.kind).name}，${liveLandmark(landmarkAt(s, p)) ? '生效中' : '休眠中'}`
                        : '')
                    }
                    aria-selected={selected}
                    tabIndex={focus.x === p.x && focus.y === p.y ? 0 : -1}
                    className={`cell ${row < 5 ? 'north' : row > 7 ? 'south' : 'contested'} ${range ? 'in-range' : ''} ${valid ? `legal ${tone} ${t ? 'occupied-target' : ''}` : ''} ${selected ? 'selected-cell' : ''} ${inPreview ? 'area-preview' : ''}`}
                    onClick={() => onCell(p)}
                    onFocus={() => {
                      setFocus(p);
                      setHover(p);
                    }}
                    onMouseEnter={() => setHover(p)}
                    onKeyDown={(e) => navigate(e, p)}
                  >
                    <span className="cell-dot" />
                    {valid && !t && !route && <span className="target-dot" />}
                    {valid && route && (
                      <span className="route-choice" aria-hidden="true">
                        {directionArrow[route.direction]}
                        <small>{route.path.length - 1}</small>
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
          {!!draft?.path?.length && (
            <svg className="attack-route-preview" viewBox="0 0 9 13" aria-hidden="true">
              <polyline
                className="active"
                points={draft.path.map((p) => `${p.x - 0.5},${p.y - 0.5}`).join(' ')}
              />
              {draft.path.map((p, i) => (
                <circle key={i} cx={p.x - 0.5} cy={p.y - 0.5} r="0.08" fill="currentColor" />
              ))}
            </svg>
          )}
          {!!routes.length && (
            <svg className="attack-route-preview" viewBox="0 0 9 13" aria-hidden="true">
              {routes.map((r) => {
                const before = r.path.at(-2)!,
                  active = hover?.x === before.x && hover?.y === before.y;
                return (
                  <polyline
                    key={r.direction}
                    className={active ? 'active' : ''}
                    points={r.path.map((p) => `${p.x - 0.5},${p.y - 0.5}`).join(' ')}
                  />
                );
              })}
            </svg>
          )}
          <div className="frontier frontier-one" aria-hidden="true">
            <span>交 锋 区</span>
          </div>
          <div className="frontier frontier-two" aria-hidden="true" />
          {s.hazards.map((h) => (
            <div
              key={h.id}
              className={`hazard hazard-${h.axis}`}
              aria-hidden="true"
              style={
                h.axis === 'row'
                  ? { top: `${((h.line - 1) / 13) * 100}%`, height: `${100 / 13}%` }
                  : { left: `${((h.line - 1) / 9) * 100}%`, width: `${100 / 9}%` }
              }
            />
          ))}
          {s.iceMarks.map((m) => (
            <div
              className="ice-ground"
              key={m.id}
              aria-hidden="true"
              style={{ left: `${((m.x - 1) / 9) * 100}%`, top: `${((m.y - 1) / 13) * 100}%` }}
            >
              <svg viewBox="-50 -50 100 100">
                <path d="M0 -35 V35 M-30 -18 L30 18 M-30 18 L30 -18 M-12 -25 L0 -13 L12 -25 M-12 25 L0 13 L12 25" />
              </svg>
            </div>
          ))}
          <svg className="siphon-layer" viewBox="0 0 900 1300" aria-hidden="true">
            {s.siphons.map((l) => {
              const a = l.fromId.startsWith('base-')
                  ? basePoint(Number(l.fromId.at(-1)) as Player)
                  : s.units.find((u) => u.id === l.fromId),
                b = l.toId.startsWith('base-')
                  ? basePoint(Number(l.toId.at(-1)) as Player)
                  : s.units.find((u) => u.id === l.toId);
              const start = a
                  ? center(a, 'size' in a && typeof a.size === 'number' ? a.size : 1)
                  : null,
                end = b ? center(b, 'size' in b && typeof b.size === 'number' ? b.size : 1) : null;
              return start && end ? (
                <g key={l.id}>
                  <path d={`M${start.x} ${start.y} L${end.x} ${end.y}`} className="siphon-thread" />
                  <path
                    d="M-10 -7 L0 0 L-10 7"
                    className="siphon-direction"
                    transform={`translate(${start.x + (end.x - start.x) * 0.7} ${start.y + (end.y - start.y) * 0.7}) rotate(${(Math.atan2(end.y - start.y, end.x - start.x) * 180) / Math.PI})`}
                  />
                </g>
              ) : null;
            })}
          </svg>
          {([1, 2] as Player[]).map((p) => {
            const at = basePoint(p);
            return (
              <div
                className={`base-token p${p}`}
                key={p}
                aria-hidden="true"
                style={{ left: `${((at.x - 1) / 9) * 100}%`, top: `${((at.y - 1) / 13) * 100}%` }}
              >
                <Icon name="crown" size={25} />
                <b>{s.bases[p]}</b>
                {s.baseEffects[p].some((e) => e.type === 'mark') && (
                  <span className="base-mark">◆</span>
                )}
              </div>
            );
          })}
          {(s.landmarks ?? []).map((l) => (
            <div
              key={l.id}
              aria-hidden="true"
              className={`landmark-tile p${l.owner} ${liveLandmark(l) ? '' : 'dormant'} ${l.id === selectedId ? 'selected' : ''}`}
              style={{
                left: `${((l.x - 1) / 9) * 100}%`,
                top: `${((l.y - 1) / 13) * 100}%`,
                width: `${100 / 9}%`,
                height: `${100 / 13}%`,
              }}
            >
              <span>{definition(l.kind).glyph}</span>
              <b>
                {liveLandmark(l)
                  ? l.hp
                  : `休${Math.max(0, definition(l.kind).landmark!.rebuild - (l.rebuildTicks ?? 0))}`}
              </b>
            </div>
          ))}
          {s.units
            .filter(
              (u) =>
                u.kind !== 'u25' ||
                s.units.find((v) => v.kind === 'u25' && v.x === u.x && v.y === u.y)?.id === u.id,
            )
            .map((u) => {
              const d = definition(u.kind),
                stats = getStats(s, u),
                stack = s.units.filter((v) => v.x === u.x && v.y === u.y),
                selected = stack.some((v) => v.id === selectedId),
                size = u.size;
              return (
                <PiecePosition
                  unit={u}
                  batches={effects}
                  reduced={reduced}
                  key={u.id}
                  className={`piece-wrap p${u.owner} ${size === 2 ? 'large-piece' : ''} ${selected ? 'piece-selected' : ''} ${d.tier !== 'normal' && typeof u.kind !== 'number' && !['3p', 'grave', 'wall'].includes(String(u.kind)) ? 'ultimate-piece' : ''} ${stats.frozen ? 'frozen-piece' : ''}`}
                  style={{
                    left: `${((u.x - 1) / 9) * 100}%`,
                    top: `${((u.y - 1) / 13) * 100}%`,
                    width: `${(size / 9) * 100}%`,
                    height: `${(size / 13) * 100}%`,
                  }}
                >
                  <PieceFace unit={u} batches={effects} reduced={reduced} sleeping={stats.sleeping}>
                    <span className="piece-heading" />
                    <span className="piece-code">
                      {u.kind === '3p'
                        ? '3′'
                        : String(u.kind).startsWith('u')
                          ? String(u.kind).toUpperCase()
                          : typeof u.kind === 'number'
                            ? u.kind
                            : '◆'}
                    </span>
                    <strong>{d.glyph}</strong>
                    <span className="piece-hp">{format(u.hp)}</span>
                    <div className="piece-health">
                      <i style={{ width: `${(u.hp / u.maxHp) * 100}%` }} />
                    </div>
                    {u.effects.some(
                      (e) =>
                        e.type === 'immune' &&
                        e.from <= s.ply + u.offset &&
                        e.until > s.ply + u.offset,
                    ) && <span className="shield-halo" />}
                    {u.effects.some((e) => e.type === 'mark') && (
                      <span className="mark-dot">·</span>
                    )}
                    {u.effects.some((e) => e.type === 'convert' || e.type === 'execute') && (
                      <span className="pending-seal">
                        {u.effects.some((e) => e.type === 'execute') ? '灭' : '策'}
                      </span>
                    )}
                    {u.equipment.length > 0 && (
                      <span className="gear-dot">{definition(u.equipment[0]).glyph}</span>
                    )}
                    {u.silenced && <span className="silence-dot">禁</span>}
                    {stats.frozen && <span className="frost-crystal">❄</span>}
                  </PieceFace>
                  <div className="action-pips">
                    {Array.from(
                      { length: Math.min(6, stats.actions || stats.operationLimit) },
                      (_, i) => (
                        <i
                          key={i}
                          className={
                            (stats.actions ? i < stats.remaining : i < stats.operationsLeft)
                              ? 'available'
                              : ''
                          }
                        />
                      ),
                    )}
                  </div>
                  {stats.sleeping && <span className="sleep-badge">休</span>}
                  {stack.length > 1 && <span className="stack-badge">×{stack.length}</span>}
                </PiecePosition>
              );
            })}
          <Effects batches={effects} reduced={reduced} />
        </div>
      </div>
      <div className="board-legend">
        <span>
          <i className="legend-dot move" />
          落点
        </span>
        <span>
          <i className="legend-dot attack" />
          目标
        </span>
        <span>❄ 冰冻</span>
        <span>▱ 地标 · 同格点击切换</span>
        <span className="hover-coordinate">
          {hover ? `(${hover.x}, ${hover.y})` : '方向键选格'}
        </span>
      </div>
    </section>
  );
}
