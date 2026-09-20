import { useEffect, useRef, type ReactNode } from 'react';
import type { Unit } from '../../../engine';
import type { EffectBatch } from './plan';

/** Animate the face only: grid positioning, HP and input remain authoritative. */
export function PieceFace({
  unit,
  batches,
  reduced,
  sleeping,
  children,
}: {
  unit: Unit;
  batches: EffectBatch[];
  reduced: boolean;
  sleeping: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const matches = batches
    .flatMap((batch) => batch.cues.map((cue) => ({ batch, cue })))
    .filter(
      ({ cue }) =>
        (cue.subject?.id === unit.id && ['damage', 'spawn'].includes(cue.family)) ||
        (cue.actor?.id === unit.id &&
          ['slash', 'arrow', 'cannon', 'bolt'].includes(cue.family) &&
          cue.actor.x === unit.x &&
          cue.actor.y === unit.y),
    );
  const latest = matches.at(-1);
  const key = latest ? `${latest.batch.id}:${latest.cue.id}` : '';
  useEffect(() => {
    if (reduced || !latest || !ref.current?.animate) return;
    const { batch, cue } = latest;
    const hit = cue.family === 'damage';
    const duration = hit ? 300 : 360;
    const elapsed = performance.now() - batch.born - cue.start;
    if (elapsed >= duration) return;
    const dx = cue.to.x - cue.from.x,
      dy = cue.to.y - cue.from.y;
    const length = Math.hypot(dx, dy) || 1;
    const amount = cue.family === 'cannon' ? -5 : cue.family === 'slash' ? 10 : 3;
    const frames =
      cue.family === 'spawn'
        ? [
            { transform: 'scale(0.7)', opacity: 0.5 },
            { transform: 'scale(1.04)', opacity: 1 },
            { transform: 'scale(1)' },
          ]
        : hit
          ? [
              { transform: 'translateX(0)' },
              { transform: 'translateX(-3px)', offset: 0.22 },
              { transform: 'translateX(2px)', offset: 0.55 },
              { transform: 'translateX(0)' },
            ]
          : [
              { transform: 'translate(0,0)' },
              {
                transform: `translate(${(dx / length) * amount}%,${(dy / length) * amount}%)`,
                offset: 0.35,
              },
              { transform: 'translate(0,0)' },
            ];
    const animation = ref.current.animate(frames, {
      duration,
      delay: Math.max(0, -elapsed),
      easing: 'ease-out',
    });
    if (elapsed > 0) animation.currentTime = elapsed;
    return () => animation.cancel();
    // Geometry is snapshotted in the cue. Expiry/rerender must not replay an old action.
  }, [key, reduced]);
  return (
    <div ref={ref} className={`piece ${sleeping ? 'sleeping' : ''}`}>
      {children}
    </div>
  );
}
