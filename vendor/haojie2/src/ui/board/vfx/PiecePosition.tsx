import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import type { Unit } from '../../../engine';
import { center, MOVE_MS, type EffectBatch } from './plan';

/** The real piece is already at its new square; only a temporary transform follows the route. */
export function PiecePosition({
  unit,
  batches,
  reduced,
  className,
  style,
  children,
}: {
  unit: Unit;
  batches: EffectBatch[];
  reduced: boolean;
  className: string;
  style: CSSProperties;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const end = center(unit, unit.size);
  const latest = batches
    .flatMap((batch) => batch.cues.map((cue) => ({ batch, cue })))
    .filter(
      ({ cue }) =>
        cue.subject?.id === unit.id && cue.movement && cue.to.x === end.x && cue.to.y === end.y,
    )
    .at(-1);
  const key = latest ? `${latest.batch.id}:${latest.cue.id}` : '';
  useLayoutEffect(() => {
    if (reduced || !latest || !ref.current?.animate) return;
    const { batch, cue } = latest;
    const duration = cue.family === 'rush' ? 250 : MOVE_MS;
    const delay = cue.family === 'hook' ? cue.impact : cue.start;
    const elapsed = performance.now() - batch.born - delay;
    if (elapsed >= duration) return;
    const route = cue.movement!;
    const lengths = route.map((p, i) =>
      i ? Math.hypot(p.x - route[i - 1].x, p.y - route[i - 1].y) : 0,
    );
    const total = lengths.reduce((a, b) => a + b, 0) || 1;
    let traveled = 0;
    const frames = route.map((p, i) => {
      traveled += lengths[i];
      return {
        transform: `translate(${(p.x - end.x) / unit.size}%,${(p.y - end.y) / unit.size}%)`,
        offset: traveled / total,
      };
    });
    const animation = ref.current.animate(frames, {
      duration,
      delay: Math.max(0, -elapsed),
      fill: 'backwards',
      easing: 'linear',
    });
    if (elapsed > 0) animation.currentTime = elapsed;
    return () => animation.cancel();
  }, [key, reduced]);
  return (
    <div ref={ref} className={className} style={style} aria-hidden="true">
      {children}
    </div>
  );
}
