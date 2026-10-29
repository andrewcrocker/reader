/**
 * Kokoro voices offered in Settings; the first is the default. They share one model, so switching
 * downloads nothing. The Worker allows the same list (worker/src/render.ts).
 */
export const VOICES = [
  { id: 'af_heart', label: 'Heart (US, female)', name: 'Heart', desc: 'Warm · US English' },
  { id: 'af_bella', label: 'Bella (US, female)', name: 'Bella', desc: 'Bright · US English' },
  { id: 'am_michael', label: 'Michael (US, male)', name: 'Michael', desc: 'Calm · US English' },
] as const;

export type VoiceId = (typeof VOICES)[number]['id'];
export const DEFAULT_VOICE: VoiceId = VOICES[0].id;
export const isVoice = (v: string): v is VoiceId => VOICES.some((x) => x.id === v);

/** Download size per voice quality, as shown in First run and Settings (confirm against the spike). */
export const QUALITY = {
  high: { label: 'High quality', short: 'High', mb: 330, desc: 'closest to a person reading' },
  standard: { label: 'Standard', short: 'Standard', mb: 92, desc: 'clear, a bit flatter' },
} as const;
