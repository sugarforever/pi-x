import type { Job } from '../shared/types';
interface Store {
  get(id: string): Promise<Job | undefined>;
  put(job: Job): Promise<void>;
}
type Runner = (
  job: Job,
  signal: AbortSignal,
  progress: (text: string) => Promise<void>,
) => Promise<string>;
export function ownsJob(job: Job, sender: { tab?: { id?: number }; documentId?: string }): boolean {
  return job.tabId === sender.tab?.id && (!job.documentId || job.documentId === sender.documentId);
}
export class JobManager {
  private active = new Map<string, { controller: AbortController; promise: Promise<void> }>();
  private transitions = new Map<string, Promise<void>>();
  constructor(
    private store: Store,
    private runner: Runner,
  ) {}
  save(job: Job) {
    return this.store.put(job);
  }
  private mutate(id: string, update: (job: Job) => Job | undefined): Promise<void> {
    const previous = this.transitions.get(id) || Promise.resolve();
    const next = previous
      .catch(() => {})
      .then(async () => {
        const job = await this.store.get(id);
        if (!job) return;
        const changed = update(job);
        if (changed) await this.store.put(changed);
      });
    this.transitions.set(id, next);
    void next
      .finally(() => {
        if (this.transitions.get(id) === next) this.transitions.delete(id);
      })
      .catch(() => {});
    return next;
  }
  touch(id: string) {
    return this.mutate(id, (j) =>
      j.status === 'running' ? { ...j, lastSeenAt: Date.now() } : undefined,
    );
  }
  async cancel(id: string) {
    this.active.get(id)?.controller.abort();
    await this.mutate(id, (j) =>
      j.status === 'running' ? { ...j, status: 'cancelled', progress: 'Cancelled' } : undefined,
    );
  }
  async run(job: Job): Promise<void> {
    const prior = this.active.get(job.id);
    if (prior) return prior.promise;
    const controller = new AbortController();
    const work = Promise.resolve().then(async () => {
      try {
        const current = await this.store.get(job.id);
        if (current?.status !== 'running') return;
        const draft = await this.runner(job, controller.signal, (text) =>
          this.mutate(job.id, (j) =>
            j.status === 'running' && !controller.signal.aborted
              ? { ...j, progress: text }
              : undefined,
          ),
        );
        await this.mutate(job.id, (j) =>
          j.status === 'running' && !controller.signal.aborted
            ? { ...j, status: 'done', progress: 'Draft ready', draft }
            : undefined,
        );
      } catch (error) {
        await this.mutate(job.id, (j) =>
          j.status === 'running' && !controller.signal.aborted
            ? {
                ...j,
                status: 'error',
                progress: 'Could not generate draft',
                error: error instanceof Error ? error.message : 'Generation failed.',
              }
            : undefined,
        );
      } finally {
        this.active.delete(job.id);
      }
    });
    this.active.set(job.id, { controller, promise: work });
    return work;
  }
}
