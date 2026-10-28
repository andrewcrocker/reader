import { ensureVoiceModel } from '../pipeline/runner';

const SAMPLE = 'Here is how this voice sounds reading an article aloud.';
let ctx: AudioContext | null = null;
let playing: AudioBufferSourceNode | null = null;

/**
 * Play a short sample of a voice. DESIGN calls for bundled clips that work before the model is
 * downloaded; until those exist this synthesizes one on the device, so it needs the model.
 */
export async function playSample(voice: string): Promise<void> {
  const engine = await ensureVoiceModel();
  const r = await engine.synthesize(SAMPLE, voice);
  ctx ??= new AudioContext();
  playing?.stop();
  const buf = ctx.createBuffer(1, r.pcm.length, r.sampleRate);
  buf.copyToChannel(new Float32Array(r.pcm), 0);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.start();
  playing = src;
}
