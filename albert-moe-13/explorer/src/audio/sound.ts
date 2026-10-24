/**
 * Procedural sound of the explorer: Web Audio only, no audio files. Off by default; nothing is created
 * (no AudioContext, no node) before the first user gesture has called `init()` AND the visitor has
 * turned the sound on. The sound is OFF on every visit: "on" is never stored (a surprise sound is worse
 * than one extra click on "Sound on"). Three cues:
 *   routerClick()        a short soft tick when a router picks its experts;
 *   tokenRise(progress)  a brief tone whose pitch rises with how far the word has got (0..1);
 *   roomTone(on)         a quiet low hum of the room, while the visitor is in the scene.
 * The sound is decoration: it carries no data and never stands in for a number.
 */

/** The parts of the Web Audio API the cues use (an AudioContext satisfies it; tests pass a fake). */
export interface AudioLike {
  readonly currentTime: number;
  readonly destination: AudioNode;
  readonly state?: string;
  resume?(): Promise<void>;
  suspend?(): Promise<void>;
  close?(): Promise<void>;
  createOscillator(): OscillatorNode;
  createGain(): GainNode;
  createBiquadFilter(): BiquadFilterNode;
}

export interface Sound {
  /** Call from a user gesture (pointerdown / keydown). Unlocks audio; before it every cue is a no-op. */
  init(): void;
  unlocked(): boolean;
  /** mute(true) silences everything (the default); mute(false) turns the sound on. */
  mute(m: boolean): void;
  muted(): boolean;
  routerClick(): void;
  tokenRise(progress: number): void;
  roomTone(on: boolean): void;
  /** Fires after mute() changes (lobby and HUD toggles share this state). */
  onChange(cb: () => void): () => void;
  /** Number of AudioContexts created so far (0 until a gesture and sound on). */
  contexts(): number;
}

export interface SoundOptions {
  /** Creates the audio context; default `new AudioContext()` where the browser has one. */
  create?: () => AudioLike | null;
}

function defaultCreate(): AudioLike | null {
  const w = typeof window === 'undefined' ? undefined : (window as unknown as { AudioContext?: new () => AudioLike; webkitAudioContext?: new () => AudioLike });
  const C = w?.AudioContext ?? w?.webkitAudioContext;
  try {
    return C ? new C() : null;
  } catch {
    return null;
  }
}

export function createSound(opts: SoundOptions = {}): Sound {
  const create = opts.create ?? defaultCreate;
  let isMuted = true;
  let gesture = false;
  let ctx: AudioLike | null = null;
  let made = 0;
  let master: GainNode | null = null;
  let room: { osc: OscillatorNode[]; gain: GainNode } | null = null;
  let wantRoom = false;
  let lastClick = -1;
  const listeners = new Set<() => void>();

  /** The live context, created on demand once a gesture happened and the sound is on. */
  const audio = (): AudioLike | null => {
    if (!gesture || isMuted) return null;
    if (!ctx) {
      ctx = create();
      if (!ctx) return null;
      made++;
      master = ctx.createGain();
      master.gain.value = 0.6;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') void ctx.resume?.().catch(() => undefined);
    return ctx;
  };

  /** A short enveloped tone. */
  const blip = (freq: number, type: OscillatorType, peak: number, attack: number, decay: number, endFreq?: number): void => {
    const a = audio();
    if (!a || !master) return;
    const t0 = a.currentTime;
    const osc = a.createOscillator();
    const g = a.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, t0 + attack + decay);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
    osc.connect(g);
    g.connect(master);
    osc.start(t0);
    osc.stop(t0 + attack + decay + 0.02);
  };

  const startRoom = (): void => {
    const a = audio();
    if (!a || !master || room) return;
    const t0 = a.currentTime;
    const gain = a.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.035, t0 + 1.5);
    const lp = a.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 320;
    // Two slightly detuned low sines beat slowly: a calm room, not a drone.
    const osc = [55, 55.4, 110.3].map((f) => {
      const o = a.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      o.connect(lp);
      o.start(t0);
      return o;
    });
    lp.connect(gain);
    gain.connect(master);
    room = { osc, gain };
  };
  const stopRoom = (): void => {
    if (!room || !ctx) { room = null; return; }
    const t0 = ctx.currentTime;
    room.gain.gain.cancelScheduledValues(t0);
    room.gain.gain.setValueAtTime(Math.max(room.gain.gain.value, 0.0001), t0);
    room.gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.6);
    for (const o of room.osc) o.stop(t0 + 0.7);
    room = null;
  };

  const s: Sound = {
    init() {
      if (gesture) return;
      gesture = true;
      if (!isMuted && wantRoom) startRoom();
    },
    unlocked: () => gesture,
    mute(m) {
      if (m === isMuted) return;
      isMuted = m;
      // Mute also suspends the context (no idle audio thread); unmute resumes it.
      if (m) {
        stopRoom();
        void ctx?.suspend?.().catch(() => undefined);
      } else {
        void ctx?.resume?.().catch(() => undefined);
        if (wantRoom) startRoom();
      }
      listeners.forEach((l) => l());
    },
    muted: () => isMuted,
    routerClick() {
      const a = audio();
      if (!a) return;
      // At most one tick every 60 ms: a fast run never turns into a buzz.
      if (lastClick >= 0 && a.currentTime - lastClick < 0.06) return;
      lastClick = a.currentTime;
      blip(1760, 'triangle', 0.05, 0.003, 0.05);
    },
    tokenRise(progress) {
      const p = Math.min(Math.max(Number.isFinite(progress) ? progress : 0, 0), 1);
      // Two octaves, 220 Hz at the first layer to 880 Hz at the last.
      blip(220 * Math.pow(4, p), 'sine', 0.04, 0.01, 0.16);
    },
    roomTone(on) {
      wantRoom = on;
      if (on) startRoom();
      else stopRoom();
    },
    onChange(cb) { listeners.add(cb); return () => listeners.delete(cb); },
    contexts: () => made,
  };
  return s;
}

/** The app's one sound. */
export const sound = createSound();

/** Unlocks `snd` on the first pointerdown or keydown in `doc` (capture phase). Returns a detach function. */
export function unlockOnGesture(snd: Pick<Sound, 'init'>, doc: Document = document): () => void {
  const on = (): void => {
    snd.init();
    off();
  };
  const off = (): void => {
    doc.removeEventListener('pointerdown', on, true);
    doc.removeEventListener('keydown', on, true);
  };
  doc.addEventListener('pointerdown', on, true);
  doc.addEventListener('keydown', on, true);
  return off;
}
