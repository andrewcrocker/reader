let ctx: AudioContext | null = null;
let playing: AudioBufferSourceNode | null = null;

/** Play a voice's bundled sample clip (public/voices/<id>.mp3), so it works offline and before any download. */
export async function playSample(voice: string): Promise<void> {
  const res = await fetch(`/voices/${voice}.mp3`);
  if (!res.ok) throw new Error(`No sample for ${voice}`);
  ctx ??= new AudioContext();
  const buf = await ctx.decodeAudioData(await res.arrayBuffer());
  playing?.stop();
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.start();
  playing = src;
}
