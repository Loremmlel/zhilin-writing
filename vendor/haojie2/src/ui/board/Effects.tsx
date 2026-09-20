import type { CSSProperties } from 'react';
import type { EffectBatch } from './vfx/plan';
import { Shape } from './vfx/Shapes';

export function Effects({ batches, reduced }: { batches: EffectBatch[]; reduced: boolean }) {
  return (
    <svg
      className={`effects-layer ${reduced ? 'vfx-reduced' : ''}`}
      viewBox="0 0 900 1300"
      aria-hidden="true"
    >
      {batches.map((batch) => (
        <g key={batch.id} data-fx-batch={batch.id}>
          {batch.cues.map((cue) => (
            <g
              key={cue.id}
              data-fx={cue.family}
              data-stage={cue.stage}
              className={`vfx vfx-${cue.family} p${cue.owner}`}
              style={{ '--delay': `${cue.start}ms`, '--hit': `${cue.impact}ms` } as CSSProperties}
            >
              <Shape cue={cue} reduced={reduced} />
            </g>
          ))}
        </g>
      ))}
    </svg>
  );
}
