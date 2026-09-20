import type { GameEvent } from '../../engine';
/** Optional synthesized audio: no media downloads and no autoplay. */
export class Soundscape {
  private context: AudioContext | null = null;
  play(events: GameEvent[], enabled: boolean): void {
    if (!enabled || typeof window === 'undefined' || !window.AudioContext) return;
    try {
      this.context ??= new AudioContext();
      void this.context.resume().catch(() => {});
      const cue = events.find((e) => ['attack', 'heal', 'spawn', 'turn'].includes(e.type));
      if (!cue) return;
      const c = this.context,
        osc = c.createOscillator(),
        gain = c.createGain(),
        now = c.currentTime;
      const healing = cue.type === 'heal',
        attack = cue.type === 'attack';
      osc.type = attack ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(attack ? 280 : healing ? 440 : 520, now);
      osc.frequency.exponentialRampToValueAtTime(attack ? 65 : healing ? 880 : 680, now + 0.16);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.045, now + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.23);
      osc.connect(gain);
      gain.connect(c.destination);
      osc.start(now);
      osc.stop(now + 0.25);
    } catch {
      /* Audio is an enhancement; a blocked device cannot interrupt play. */
    }
  }
  dispose(): void {
    if (this.context) void this.context.close().catch(() => {});
    this.context = null;
  }
}
