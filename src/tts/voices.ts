/** Kokoro voices offered in Settings. They share one model, so switching downloads nothing. */
export const VOICES = [
  { id: 'af_heart', label: 'Heart (US, female)', name: 'Heart', desc: 'Warm · US English' },
  { id: 'am_michael', label: 'Michael (US, male)', name: 'Michael', desc: 'Calm · US English' },
  { id: 'af_bella', label: 'Bella (US, female)', name: 'Bella', desc: 'Bright · US English' },
  { id: 'bf_emma', label: 'Emma (UK, female)', name: 'Emma', desc: 'Clear · UK English' },
  { id: 'bm_george', label: 'George (UK, male)', name: 'George', desc: 'Steady · UK English' },
] as const;

export type VoiceId = (typeof VOICES)[number]['id'];

/** Download size per voice quality, as shown in First run and Settings (confirm against the spike). */
export const QUALITY = {
  high: { label: 'High quality', short: 'High', mb: 330, desc: 'closest to a person reading' },
  standard: { label: 'Standard', short: 'Standard', mb: 92, desc: 'clear, a bit flatter' },
} as const;
