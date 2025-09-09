import { Injectable } from '@angular/core';

export interface OfflineTask {
  id: string;
  type: 'punchIn' | 'punchOut';
  payload: any;
  createdAt: number;
}

/**
 * Very lightweight in-memory + localStorage offline queue.
 * For production, consider IndexedDB (e.g., localforage) and background sync.
 */
@Injectable({ providedIn: 'root' })
export class OfflineQueueService {
  private key = 'offline_punch_queue_v1';
  private tasks: OfflineTask[] = [];

  constructor() {
    this.load();
  }

  private load() {
    try {
      const raw = localStorage.getItem(this.key);
      if (raw) this.tasks = JSON.parse(raw) || [];
    } catch { /* ignore */ }
  }

  private persist() {
    try { localStorage.setItem(this.key, JSON.stringify(this.tasks)); } catch { /* ignore */ }
  }

  enqueue(task: Omit<OfflineTask, 'id' | 'createdAt'>) {
    const full: OfflineTask = { id: crypto.randomUUID(), createdAt: Date.now(), ...task } as OfflineTask;
    this.tasks.push(full);
    this.persist();
  }

  peekAll(): OfflineTask[] { return [...this.tasks]; }

  remove(id: string) {
    this.tasks = this.tasks.filter(t => t.id !== id);
    this.persist();
  }

  clear() { this.tasks = []; this.persist(); }

  /** Process tasks sequentially using provided handlers. Returns summary. */
  async process(handlers: { punchIn: (payload:any)=>Promise<void>; punchOut: (payload:any)=>Promise<void>; }): Promise<{processed:number; remaining:number; errors:number;}> {
    const original = [...this.tasks];
    let processed = 0; let errors = 0;
    for (const t of original) {
      try {
        if (t.type === 'punchIn') {
          await handlers.punchIn(t.payload);
        } else if (t.type === 'punchOut') {
          await handlers.punchOut(t.payload);
        }
        this.remove(t.id);
        processed++;
      } catch {
        errors++;
      }
    }
    return { processed, remaining: this.tasks.length, errors };
  }
}
