import { DurableObject, WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { NonRetryableError } from 'cloudflare:workflows';
import { applyReservation, renderChunk, VoiceHostError, type Lookup, type PartParams, type QuotaApi, type RenderChunk, type RenderEnv, type Reservation } from './render';
import { planRender } from './voiceCache';

/** How many chunks go to the voice host at once. More didn't help in the spike: its queue is per account. */
const PARALLEL = 4;

/** Renders one part of an article: each chunk is a step, so a crash or redeploy resumes where it stopped. */
export class RenderWorkflow extends WorkflowEntrypoint<RenderEnv, PartParams> {
  async run(event: Readonly<WorkflowEvent<PartParams>>, step: WorkflowStep) {
    const { voice, chunks, job } = event.payload;
    for (let start = 0; start < chunks.length; start += PARALLEL) {
      await Promise.all(
        chunks.slice(start, start + PARALLEL).map((chunk) =>
          step.do(
            `chunk ${chunk.i}`,
            { retries: { limit: 5, delay: '5 seconds', backoff: 'exponential' }, timeout: '3 minutes' },
            async () => {
              try {
                return await renderChunk(this.env, job, voice, chunk);
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

  /**
   * `reserve` for the voice cache: looks the chunks up first, so the budget is charged for the misses only.
   * The lookups wait on R2 before the state is read, so the read-and-write below stays one uninterrupted step.
   */
  async reserveMisses(voice: string, chunks: RenderChunk[], cap: number, now: number): Promise<Reservation & { lookups: Lookup[] }> {
    const { lookups, missChars } = await planRender(this.env.AUDIO, voice, chunks, now);
    const prev = (await this.ctx.storage.get<QuotaState>('state')) ?? { day: '', used: 0, alerted80: false, alerted100: false };
    const { state, result } = applyReservation(prev, missChars, cap, now);
    await this.ctx.storage.put('state', state);
    return { ...result, lookups };
  }
}
