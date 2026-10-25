import { spokenText } from '../data/airlines';

export type Speaker = 'TWR' | 'GND' | 'RAMP' | 'PILOT' | 'SYS' | 'ALERT';

export interface RadioMsg { t: number; who: Speaker; text: string; callsign?: string }

/** Radio transcript with optional text-to-speech (controller and pilot voices). */
export class Radio {
  msgs: RadioMsg[] = [];
  speech = false;
  private listeners: ((m: RadioMsg) => void)[] = [];
  private voices: SpeechSynthesisVoice[] = [];
  private queue: RadioMsg[] = [];

  constructor() {
    if ('speechSynthesis' in window) {
      const load = () => (this.voices = speechSynthesis.getVoices().filter((v) => v.lang.startsWith('en')));
      load();
      speechSynthesis.addEventListener?.('voiceschanged', load);
    }
  }

  onMessage(fn: (m: RadioMsg) => void) { this.listeners.push(fn); }

  say(who: Speaker, text: string, callsign?: string) {
    const m: RadioMsg = { t: Date.now(), who, text, callsign };
    this.msgs.push(m);
    if (this.msgs.length > 300) this.msgs.shift();
    for (const l of this.listeners) l(m);
    if (this.speech && who !== 'SYS' && 'speechSynthesis' in window) {
      this.queue.push(m);
      if (this.queue.length > 4) this.queue.splice(0, this.queue.length - 4); // don't fall too far behind
      if (!speechSynthesis.speaking) this.speakNext();
    }
  }

  private speakNext() {
    const m = this.queue.shift();
    if (!m) return;
    const u = new SpeechSynthesisUtterance(spokenText(m.text.replace(/RWY/g, 'runway').replace(/\bFL(\d+)/g, 'flight level $1')));
    const atc = m.who === 'TWR' || m.who === 'GND' || m.who === 'RAMP';
    if (this.voices.length) u.voice = this.voices[atc ? 0 : Math.min(1, this.voices.length - 1)];
    u.rate = 1.12;
    u.pitch = atc ? 0.9 : 1.15;
    u.volume = m.who === 'ALERT' ? 1 : 0.85;
    u.onend = () => this.speakNext();
    speechSynthesis.speak(u);
  }

  setSpeech(on: boolean) {
    this.speech = on;
    if (!on && 'speechSynthesis' in window) { speechSynthesis.cancel(); this.queue = []; }
  }
}
