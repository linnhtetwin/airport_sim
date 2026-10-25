import { spokenText } from '../data/airlines';

export type Speaker = 'TWR' | 'GND' | 'RAMP' | 'PILOT' | 'SYS' | 'ALERT' | 'LIVE';

/**
 * Which world a message belongs to. Simulation radio calls and real-world events are kept
 * apart so nothing from the game ever appears in Live Watch (and vice versa).
 */
export type Channel = 'sim' | 'live';

export interface RadioMsg {
  t: number;
  who: Speaker;
  text: string;
  callsign?: string;
  channel: Channel;
  /** Clock time shown in the log, stamped when the message first arrives on screen. */
  clock?: string;
}

/** Radio transcript with optional text-to-speech (controller and pilot voices). */
export class Radio {
  msgs: RadioMsg[] = [];
  speech = false;
  /** Channel currently on screen; only the simulation's own calls are ever spoken. */
  active: Channel = 'sim';
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

  say(who: Speaker, text: string, callsign?: string, channel: Channel = 'sim') {
    const m: RadioMsg = { t: Date.now(), who, text, callsign, channel };
    this.msgs.push(m);
    // keep a bounded history per channel
    if (this.msgs.filter((x) => x.channel === channel).length > 300) this.msgs.splice(this.msgs.findIndex((x) => x.channel === channel), 1);
    for (const l of this.listeners) l(m);
    if (this.speech && channel === 'sim' && this.active === 'sim' && who !== 'SYS' && 'speechSynthesis' in window) {
      this.queue.push(m);
      if (this.queue.length > 4) this.queue.splice(0, this.queue.length - 4); // don't fall too far behind
      if (!speechSynthesis.speaking) this.speakNext();
    }
  }

  /** Switch the channel on screen; anything still queued for speech is dropped. */
  setActive(channel: Channel) {
    this.active = channel;
    if ('speechSynthesis' in window) { speechSynthesis.cancel(); this.queue = []; }
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
