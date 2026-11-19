// Sound and haptics for the practice app: short tones synthesized with WebAudio (no files, no network)
// and a phone buzz. One shared AudioContext, created on the first sound (always after a tap).

export type Sfx = 'tap' | 'correct' | 'wrong' | 'combo' | 'tick' | 'go' | 'fanfare' | 'chest';

const SEQ: Record<Sfx, [freq: number, at: number, len: number][]> = {
  tap: [[520, 0, 0.05]],
  correct: [[659, 0, 0.12], [880, 0.1, 0.2]],
  wrong: [[220, 0, 0.16], [165, 0.12, 0.22]],
  combo: [[784, 0, 0.08], [988, 0.07, 0.08], [1175, 0.14, 0.16]],
  tick: [[880, 0, 0.07]],
  go: [[660, 0, 0.1], [990, 0.1, 0.25]],
  fanfare: [[523, 0, 0.12], [659, 0.12, 0.12], [784, 0.24, 0.12], [1047, 0.36, 0.34]],
  chest: [[587, 0, 0.09], [784, 0.08, 0.09], [988, 0.16, 0.09], [1319, 0.24, 0.28]],
};

let ac: AudioContext | null = null;

export function sfx(kind: Sfx, on = true) {
  if (!on || typeof window === 'undefined') return;
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ac = ac || new AC();
    if (ac.state === 'suspended') ac.resume();
    for (const [f, at, len] of SEQ[kind]) {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = kind === 'wrong' ? 'triangle' : 'sine';
      o.frequency.value = f;
      const t0 = ac.currentTime + at;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.16, t0 + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + len);
      o.connect(g); g.connect(ac.destination);
      o.start(t0); o.stop(t0 + len + 0.03);
    }
  } catch (e) { /* no audio: stay silent */ }
}

export function buzz(ms: number | number[], on = true) {
  if (!on) return;
  try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* not supported */ }
}

export const reducedMotion = () => {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
};
