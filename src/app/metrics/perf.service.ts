import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class PerfService {
  private t0: number | null = null;
  start(label = 'app_start') { if (this.t0 === null) this.t0 = performance.now(); }
  mark(label: string) { performance.mark(label); }
  async stop(label = 'startup_to_dashboard') {
    if (this.t0 !== null) {
      const dur = performance.now() - this.t0;
      console.info('[perf]', label, Math.round(dur) + 'ms');
      this.t0 = null;
    }
  }
}
