import { DurableObject, WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { NonRetryableError } from 'cloudflare:workflows';
import { applyReservation, synthesizeChunk, VoiceHostError, type QuotaApi, type RenderEnv, type RenderParams, type Reservation } from './render';

/** How many chunks go to the voice host at once. More didn't help in the spike: its queue is per account. */
const PARALLEL = 4;

/** Renders one article: each chunk is a step, so a crash or redeploy resumes where it stopped. */
export class RenderWorkflow extends WorkflowEntrypoint<RenderEnv, RenderParams> {
  async run(event: Readonly<WorkflowEvent<RenderParams>>, step: WorkflowStep) {
    const { voice, chunks } = event.payload;
    const job = event.instanceId;
    for (let start = 0; start < chunks.length; start += PARALLEL) {
      await Promise.all(
        chunks.slice(start, start + PARALLEL).map((chunk) =>
          step.do(
            `chunk ${chunk.i}`,
            { retries: { limit: 5, delay: '5 seconds', backoff: 'exponential' }, timeout: '3 minutes' },
            async () => {
              try {
                const { mp3, sec } = await synthesizeChunk(this.env, voice, chunk.text);
                await this.env.AUDIO.put(`jobs/${job}/${chunk.i}.mp3`, mp3, { customMetadata: { sec: sec.toFixed(3) } });
                return sec;
              } catch (err) {
                if (err instanceof VoiceHostError && err.permanent) throw new NonRetryableError(err.message);
                throw err;
              }
            },
          ),
        ),
      );
    }
  }
}

type QuotaState = { day: string; used: number; alerted80: boolean; alerted100: boolean };

/** One global counter of characters sent to the voice host today. */
export class QuotaCounter extends DurableObject<RenderEnv> implements QuotaApi {
  async reserve(chars: number, cap: number, now: number): Promise<Reservation> {
    const prev = (await this.ctx.storage.get<QuotaState>('state')) ?? { day: '', used: 0, alerted80: false, alerted100: false };
    const { state, result } = applyReservation(prev, chars, cap, now);
    await this.ctx.storage.put('state', state);
    return result;
  }
}
