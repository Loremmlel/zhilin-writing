import { useEffect, useRef, useState } from 'react';
import type { GameEvent } from '../../engine';
import { Soundscape } from '../audio/Soundscape';
import { useEffectPlayback } from '../board/vfx/useEffectPlayback';

/** Disposable effects only. Local and controlled sessions feed the same accepted event batches. */
export function useGamePresentation(initialNotice = '') {
  const playback = useEffectPlayback();
  const [notice, setNotice] = useState(initialNotice);
  const [events, setEvents] = useState<GameEvent[]>([]);
  const [sound, setSound] = useState(false);
  const audio = useRef<Soundscape | null>(null);
  useEffect(() => {
    if (!events.length) return;
    const timer = setTimeout(() => setEvents([]), 1700);
    return () => clearTimeout(timer);
  }, [events]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 6500);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(
    () => () => {
      audio.current?.dispose();
      audio.current = null;
    },
    [],
  );
  function clear() {
    setEvents([]);
    playback.clear();
  }
  function play(batch: GameEvent[]) {
    setEvents(batch.slice(-90));
    playback.play(batch);
    if (sound) {
      audio.current ??= new Soundscape();
      audio.current.play(batch, true);
    }
  }
  return { notice, setNotice, events, effects: playback.batches, sound, setSound, clear, play };
}
export type GamePresentation = ReturnType<typeof useGamePresentation>;
