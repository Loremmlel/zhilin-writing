import { useEffect, useRef } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { definition } from '../../../engine';
import { MOVE_MS, type Cue } from './plan';

export const routePath = (route: Cue['route']) =>
  route.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ');
const at = (p: Cue['to']) => `translate(${p.x} ${p.y})`;

/** Explicit relative start is essential: the parent SVG survives between commands. */
function Flight({ cue, children, reduced }: { cue: Cue; children: ReactNode; reduced: boolean }) {
  const motion = useRef<SVGAnimateMotionElement>(null);
  const windup = cue.family === 'cannon' ? 130 : 60;
  const launch = cue.start + windup;
  const duration = Math.max(1, cue.impact - launch);
  useEffect(() => {
    if (!reduced) motion.current?.beginElementAt(launch / 1000);
  }, [cue.id, launch, reduced]);
  if (reduced) return null;
  return (
    <g
      className="vfx-flight"
      style={{ '--launch': `${launch}ms`, '--flight': `${duration}ms` } as CSSProperties}
    >
      <g>
        {children}
        <animateMotion
          ref={motion}
          begin="indefinite"
          path={routePath(cue.route)}
          dur={`${duration}ms`}
          rotate="auto"
          fill="freeze"
          calcMode="paced"
        />
      </g>
    </g>
  );
}
function Shards({ heavy = false }: { heavy?: boolean }) {
  return (
    <g className="vfx-shards">
      {Array.from({ length: heavy ? 8 : 5 }, (_, i) => (
        <g key={i} transform={`rotate(${i * (heavy ? 45 : 72)})`}>
          <path d={heavy ? 'M-4 -32 L2 -52 L8 -34 Z' : 'M0 -25 L0 -40'} />
        </g>
      ))}
    </g>
  );
}
function Impact({ cue }: { cue: Cue }) {
  const heavy = cue.family === 'cannon' || cue.family === 'bomb';
  return (
    <g className="vfx-contact" transform={at(cue.impactTo ?? cue.to)}>
      <g className="vfx-hit">
        {heavy ? (
          <>
            <path
              className="vfx-weight"
              d="M-45 0 L-15 -15 L0 -43 L14 -14 L45 0 L14 13 L0 38 L-14 13 Z"
            />
            <circle r="48" strokeDasharray="48 22" />
            <circle r="62" className="vfx-thin" strokeDasharray="8 80" />
          </>
        ) : cue.family === 'mend' ? (
          <path className="vfx-weight" d="M-7 -23 H7 V-7 H23 V7 H7 V23 H-7 V7 H-23 V-7 H-7 Z" />
        ) : cue.family === 'stone' ? (
          <>
            <path d="M0 -30 L28 0 L0 30 L-28 0 Z" />
            <path d="M-13 0 H13 M0 -13 V13" />
          </>
        ) : (
          <>
            <path d="M-25 -13 L-9 -4 M-22 19 L-7 7 M11 -27 L4 -9 M21 16 L8 5" />
            <circle r="12" className="vfx-thin" />
          </>
        )}
        <Shards heavy={heavy} />
      </g>
    </g>
  );
}
function Projectile({ cue, reduced }: { cue: Cue; reduced: boolean }) {
  const k = cue.family;
  return (
    <>
      <path d={routePath(cue.route)} className={`vfx-trace ${k === 'hook' ? 'vfx-chain' : ''}`} />
      <g transform={at(cue.from)}>
        <g className="vfx-launch">
          {k === 'cannon' ? (
            <>
              <circle r="24" strokeDasharray="20 12" />
              <path d="M-34 0 H34 M0 -34 V34" />
            </>
          ) : (
            <path d="M-13 -15 L-20 0 L-13 15" />
          )}
        </g>
      </g>
      <Flight cue={cue} reduced={reduced}>
        {k === 'arrow' ? (
          <>
            <path d="M-36 0 H13 M-32 -7 L-23 0 L-32 7" />
            <path className="vfx-solid" d="M22 0 L6 -7 L9 0 L6 7 Z" />
          </>
        ) : k === 'cannon' ? (
          <>
            <path className="vfx-solid" d="M-20 -10 H12 L24 0 L12 10 H-20 Z" />
            <path d="M-35 -8 L-55 -8 M-35 8 L-64 8" />
          </>
        ) : k === 'stone' ? (
          <g className="vfx-lob">
            <path className="vfx-solid" d="M-13 -8 L-5 -16 L12 -10 L17 5 L2 16 L-13 9 Z" />
            <path className="vfx-paper" d="M-7 -5 L3 -9 L10 -2" />
          </g>
        ) : k === 'hook' ? (
          <>
            <path d="M-25 0 H14 Q29 0 23 15 Q15 27 5 15" />
            <path className="vfx-solid" d="M5 15 L3 27 L14 20 Z" />
          </>
        ) : k === 'mend' ? (
          <>
            <circle r="9" className="vfx-soft-fill" />
            <circle cx="-22" r="4" />
            <circle cx="-37" r="2" />
          </>
        ) : (
          <>
            <path className="vfx-solid" d="M21 0 L-5 -10 L-23 0 L-5 10 Z" />
            <path d="M-31 0 H-49" />
          </>
        )}
      </Flight>
      <Impact cue={cue} />
      {k === 'hook' && cue.stage === 'trigger' && (
        <g
          className="vfx-arrival"
          transform={at(cue.to)}
          style={{ '--hit': `${cue.impact + (cue.movement ? MOVE_MS : 0)}ms` } as CSSProperties}
        >
          <g className="vfx-hit">
            <path d="M-26 -26 H-36 V-6 M26 26 H36 V6" />
          </g>
        </g>
      )}
    </>
  );
}
function Area({ cue }: { cue: Cue }) {
  const k = cue.family;
  return (
    <g className="vfx-area">
      {cue.area.map((p, i) => (
        <g key={`${p.x},${p.y}`} transform={at(p)}>
          <g
            className="vfx-area-cell"
            style={
              {
                '--tile-delay': `${cue.start + (k === 'storm' ? Math.min(i * 14, 140) : 0)}ms`,
              } as CSSProperties
            }
          >
            <rect x="-48" y="-48" width="96" height="96" rx="4" className="vfx-area-wash" />
            {k === 'storm' || k === 'burn' ? (
              <>
                <path
                  className="vfx-flame"
                  d="M-21 29 C-43 6 -8 -4 -12 -32 C15 -13 31 10 20 29 C10 39 -14 39 -21 29 Z"
                />
                <path d="M-7 21 Q-13 6 4 -10 Q3 7 12 20" />
              </>
            ) : k === 'cross' ? (
              <>
                <path d="M-45 0 H45 M0 -45 V45" />
                <path className="vfx-solid" d="M0 -14 L14 0 L0 14 L-14 0 Z" />
              </>
            ) : k === 'quake' ? (
              <path d="M-39 15 L-13 -8 L-1 10 L20 -22 L41 -4" />
            ) : (
              <path d="M-36 -20 V-36 H-20 M20 -36 H36 V-20 M36 20 V36 H20 M-20 36 H-36 V20" />
            )}
          </g>
        </g>
      ))}
      {k === 'bomb' && <Impact cue={cue} />}
    </g>
  );
}
function Rune({ cue }: { cue: Cue }) {
  const k = cue.family;
  const glyph =
    k === 'conversion'
      ? '策'
      : k === 'execution'
        ? '灭'
        : k === 'mark'
          ? '印'
          : k === 'clock'
            ? '晷'
            : k === 'charge'
              ? '蓄'
              : k === 'inner-fire'
                ? '心'
                : cue.ability !== undefined
                  ? definition(cue.ability).glyph
                  : '◆';
  const seal = (k === 'conversion' || k === 'execution') && cue.stage !== 'trigger';
  return (
    <g transform={at(cue.to)}>
      <g className={`vfx-rune vfx-rune-${k} ${seal ? 'vfx-seal' : ''}`}>
        {k === 'ward' || k === 'counter' ? (
          <>
            <path
              className="vfx-soft-fill"
              d="M0 -45 L36 -24 L32 17 Q22 36 0 47 Q-22 36 -32 17 L-36 -24 Z"
            />
            <path d="M-25 -17 L0 -32 L25 -17 M-21 16 L0 32 L21 16" />
            {cue.stage === 'blocked' && (
              <>
                <path d="M-42 -45 L-28 -32 M32 -37 L45 -51 M40 -5 H57" />
                <path d="M-12 2 L-2 12 L17 -9" />
              </>
            )}
          </>
        ) : k === 'freeze' || k === 'ice-mark' ? (
          <>
            {[0, 60, 120].map((a) => (
              <g key={a} transform={`rotate(${a})`}>
                <path d="M0 -43 V43 M-11 -30 L0 -20 L11 -30 M-11 30 L0 20 L11 30" />
              </g>
            ))}
            <path className="vfx-soft-fill" d="M0 -45 L38 -22 V22 L0 45 L-38 22 V-22 Z" />
          </>
        ) : k === 'burn' || k === 'inner-fire' ? (
          <>
            <path
              className="vfx-flame"
              d="M-23 30 C-46 0 -10 -9 -14 -45 C20 -23 44 14 24 36 C9 52 -10 47 -23 30 Z"
            />
            <path d="M0 31 Q-17 5 8 -17 Q1 11 15 24" />
          </>
        ) : k === 'execution' && cue.stage === 'trigger' ? (
          <>
            <path className="vfx-cut" d="M-44 -48 Q3 -20 42 45 Q-11 13 -44 -48 Z" />
            <path d="M-43 35 L34 -42 M-44 -17 V-40 H-21 M21 40 H44 V17" />
            <Shards heavy />
          </>
        ) : k === 'conversion' && cue.stage === 'trigger' ? (
          <>
            <path
              className="vfx-turncoat"
              d="M-36 -28 Q-52 30 18 39 L8 24 M36 28 Q52 -30 -18 -39 L-8 -24"
            />
            <path d="M0 -29 L28 0 L0 29 L-28 0 Z" />
            <text className="vfx-glyph" y="8">
              策
            </text>
          </>
        ) : k === 'silence' ? (
          <>
            <rect x="-32" y="-32" width="64" height="64" rx="12" />
            <path d="M-33 33 L33 -33" />
            <text className="vfx-glyph" y="8">
              禁
            </text>
          </>
        ) : (
          <>
            <path d="M0 -47 L47 0 L0 47 L-47 0 Z" className={seal ? 'vfx-dashed' : ''} />
            <path d="M-29 -38 H-39 V-28 M29 38 H39 V28" />
            <circle
              r="31"
              className="vfx-thin"
              strokeDasharray={k === 'charge' ? '12 8' : undefined}
            />
            <text className="vfx-glyph" y="9">
              {glyph}
            </text>
            {seal && (
              <text className="vfx-caption" y="64">
                待触发
              </text>
            )}
            {k === 'charge' && (
              <path
                className="vfx-charge-arrows"
                d="M-68 0 H-44 L-51 -7 M68 0 H44 L51 7 M0 -68 V-44 L7 -51"
              />
            )}
          </>
        )}
      </g>
    </g>
  );
}
export function Shape({ cue, reduced }: { cue: Cue; reduced: boolean }) {
  const k = cue.family;
  if (['arrow', 'cannon', 'stone', 'bolt', 'hook', 'mend'].includes(k))
    return <Projectile cue={cue} reduced={reduced} />;
  if (['bomb', 'storm', 'cross', 'quake'].includes(k)) return <Area cue={cue} />;
  if (k === 'damage' || k === 'heal')
    return (
      <g
        transform={`translate(${cue.to.x + [0, -25, 25, -48, 48][(cue.numberSlot ?? 0) % 5]} ${cue.to.y - (cue.subject?.size ?? 1) * 30 - Math.floor((cue.numberSlot ?? 0) / 5) * 24})`}
      >
        <text className={`damage-number vfx-number ${k === 'heal' ? 'healing' : ''}`}>
          {k === 'heal' ? '+' : '−'}
          {Math.round((cue.amount ?? 0) * 10) / 10}
        </text>
      </g>
    );
  if (k === 'slash') {
    const angle = (Math.atan2(cue.to.y - cue.from.y, cue.to.x - cue.from.x) * 180) / Math.PI;
    return (
      <>
        <g transform={`${at(cue.to)} rotate(${angle})`}>
          <g className="vfx-slash">
            <path className="vfx-cut" d="M-24 -46 Q42 -20 34 39 Q4 0 -24 -46 Z" />
            <path className="vfx-thin" d="M-33 -39 Q32 -9 25 44" />
          </g>
        </g>
        <Impact cue={cue} />
      </>
    );
  }
  if (k === 'move' || k === 'rush')
    return (
      <>
        <path
          d={routePath(cue.route)}
          className={k === 'rush' ? 'vfx-rush-path' : 'vfx-move-path'}
        />
        {k === 'rush' && (
          <>
            {cue.route
              .slice(0, -1)
              .filter((_, i) => i % 2 === 0)
              .slice(-6)
              .map((p, i) => (
                <g key={i} transform={at(p)}>
                  <rect className="vfx-afterimage" x="-28" y="-28" width="56" height="56" rx="10" />
                </g>
              ))}
            <Impact cue={cue} />
          </>
        )}
      </>
    );
  if (k === 'siphon') {
    const from = cue.from;
    const flow = { ...cue, from, route: [from, cue.to] };
    if (cue.stage === 'apply')
      return (
        <>
          <path d={routePath(flow.route)} className="vfx-siphon-line" />
          <g transform={at(cue.to)}>
            <g className="vfx-rune">
              <path d="M-25 -12 L0 16 L25 -12 M-25 0 L0 28 L25 0" />
            </g>
          </g>
        </>
      );
    return (
      <>
        <path d={routePath(flow.route)} className="vfx-siphon-line" />
        <Flight cue={flow} reduced={reduced}>
          <circle r="8" className="vfx-solid" />
          <circle cx="-23" r="5" />
          <circle cx="-40" r="3" />
        </Flight>
        <g transform={at(cue.to)}>
          <g className="vfx-hit">
            <path d="M-27 -10 Q0 38 27 -10 M-19 -23 Q0 18 19 -23" />
          </g>
        </g>
      </>
    );
  }
  if (k === 'spawn' || k === 'death')
    return (
      <g transform={at(cue.to)}>
        <g className={`vfx-token-${k}`}>
          <rect x="-36" y="-36" width="72" height="72" rx="12" className="vfx-soft-fill" />
          <path d="M-49 -26 V-49 H-26 M26 -49 H49 V-26 M49 26 V49 H26 M-26 49 H-49 V26" />
          {cue.subject?.kind !== undefined && (
            <text className="vfx-glyph" y="10">
              {definition(cue.subject.kind).glyph}
            </text>
          )}
          {k === 'death' && <Shards />}
        </g>
      </g>
    );
  return <Rune cue={cue} />;
}
