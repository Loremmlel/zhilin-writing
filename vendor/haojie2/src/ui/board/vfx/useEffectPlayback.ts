import { useEffect, useRef, useState } from 'react';
import type { GameEvent } from '../../../engine';
import { appendBatch, planEffects, type EffectBatch } from './plan';

/** Presentation time only. Does not delay commands or change AI pacing. */
export function useEffectPlayback() {
  const [batches, setBatches] = useState<EffectBatch[]>([]);
  const sequence = useRef(0);
  useEffect(() => {
    if (!batches.length) return;
    const due = Math.min(...batches.map((b) => b.expires));
    const timer = setTimeout(
      () => {
        const now = performance.now();
        setBatches((old) => old.filter((b) => b.expires > now));
      },
      Math.max(1, due - performance.now()),
    );
    return () => clearTimeout(timer);
  }, [batches]);
  function play(events: readonly GameEvent[]) {
    const cues = planEffects(events);
    if (!cues.length) return;
    const born = performance.now();
    const batch = {
      id: ++sequence.current,
      born,
      expires: born + Math.max(...cues.map((c) => c.end)),
      cues,
    };
    setBatches((previous) => appendBatch(previous, batch, born));
  }
  return { batches, play, clear: () => setBatches([]) };
}
