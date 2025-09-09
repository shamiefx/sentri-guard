import { Component, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonHeader, IonToolbar, IonTitle, IonContent, IonList, IonItem, IonLabel, IonButton, IonSpinner, IonText, IonButtons } from '@ionic/angular/standalone';
import { PunchService } from '../services/punch.service';

@Component({
  selector: 'app-tab3',
  templateUrl: 'tab3.page.html',
  styleUrls: ['tab3.page.scss'],
  imports: [CommonModule, IonHeader, IonToolbar, IonTitle, IonContent, IonList, IonItem, IonLabel, IonButton, IonSpinner, IonText, IonButtons],
})
export class Tab3Page {
  loading = signal(false);
  error = signal<string | null>(null);
  currentMonthSessions = signal<any[]>([]);
  prevMonthSessions = signal<any[]>([]);
  // Active sessions (no punchOut) should appear first
  sortedCurrent = computed(() => {
    const list = [...this.currentMonthSessions()];
    return list.sort((a,b)=> {
      const aActive = !a.punchOut;
      const bActive = !b.punchOut;
      if (aActive && !bActive) return -1;
      if (!aActive && bActive) return 1;
      const aStart = a.punchIn?.toDate ? a.punchIn.toDate().getTime() : (typeof a.punchIn === 'string' ? Date.parse(a.punchIn) : a.punchIn);
      const bStart = b.punchIn?.toDate ? b.punchIn.toDate().getTime() : (typeof b.punchIn === 'string' ? Date.parse(b.punchIn) : b.punchIn);
      // After active-first, sort by most recent (descending)
      return (bStart||0) - (aStart||0);
    });
  });
  sortedPrev = computed(() => {
    const list = [...this.prevMonthSessions()];
    return list.sort((a,b)=> {
      const aActive = !a.punchOut;
      const bActive = !b.punchOut;
      if (aActive && !bActive) return -1;
      if (!aActive && bActive) return 1;
      const aStart = a.punchIn?.toDate ? a.punchIn.toDate().getTime() : (typeof a.punchIn === 'string' ? Date.parse(a.punchIn) : a.punchIn);
      const bStart = b.punchIn?.toDate ? b.punchIn.toDate().getTime() : (typeof b.punchIn === 'string' ? Date.parse(b.punchIn) : b.punchIn);
      return (bStart||0) - (aStart||0);
    });
  });
  showPrev = signal(false);
  currentMonthLabel = signal('');
  prevMonthLabel = signal('');
  currentTotalClosedMs = computed(() => this.currentMonthSessions().filter(s=>s.punchOut).reduce((acc, s)=> acc + this.durationMs(s),0));
  prevTotalClosedMs = computed(() => this.prevMonthSessions().filter(s=>s.punchOut).reduce((acc, s)=> acc + this.durationMs(s),0));

  // Daily grouped totals (closed sessions only)
  currentDailyTotals = computed(() => this.buildDailyTotals(this.currentMonthSessions()));
  prevDailyTotals = computed(() => this.buildDailyTotals(this.prevMonthSessions()));

  // Grouped sessions by date including total per day (closed sessions contribute to total)
  currentGrouped = computed(() => this.buildGrouped(this.currentMonthSessions()));
  prevGrouped = computed(() => this.buildGrouped(this.prevMonthSessions()));

  constructor(private punchService: PunchService) {}

  ionViewWillEnter() { this.loadCurrent(); }

  private monthLabel(year:number, monthIndex:number) {
    const date = new Date(year, monthIndex, 1);
    return date.toLocaleDateString(undefined,{ month:'long', year:'numeric' });
  }

  async loadCurrent() {
    this.loading.set(true); this.error.set(null);
    try {
      const now = new Date();
      const y = now.getFullYear(); const m = now.getMonth();
      this.currentMonthLabel.set(this.monthLabel(y,m));
      const list = await this.punchService.getMonthSessions(y,m);
      this.currentMonthSessions.set(list);
      // Precompute prev label
      const pmDate = new Date(y, m-1, 1);
      this.prevMonthLabel.set(this.monthLabel(pmDate.getFullYear(), pmDate.getMonth()));
    } catch (e:any) {
      this.error.set(e.message || 'Failed to load');
    } finally { this.loading.set(false); }
  }

  async togglePrev() {
    this.showPrev.set(!this.showPrev());
    if (this.showPrev() && this.prevMonthSessions().length === 0) {
      try {
        this.loading.set(true);
        const now = new Date();
        const pm = new Date(now.getFullYear(), now.getMonth()-1, 1);
        const list = await this.punchService.getMonthSessions(pm.getFullYear(), pm.getMonth());
        this.prevMonthSessions.set(list);
      } catch (e:any) {
        this.error.set(e.message || 'Failed to load prev month');
      } finally { this.loading.set(false); }
    }
  }

  formatMs(ms: number) {
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000)/60000);
    return `${h}h ${m}m`;
  }

  durationMs(s: any) {
    if(!s.punchOut) return 0;
    const start = s.punchIn?.toDate ? s.punchIn.toDate().getTime() : s.punchIn;
    const end = s.punchOut?.toDate ? s.punchOut.toDate().getTime() : s.punchOut;
    if (typeof start !== 'number' || typeof end !== 'number') return 0;
    return Math.max(0, end-start);
  }

  decimalHours(ms: number) { return (ms / 3600000); }

  checkpointsCount(s:any): number { return s.checkpoints?.length || 0; }

  private buildDailyTotals(list: any[]) {
    const map = new Map<string, number>();
    list.forEach(s => {
      if (!s.punchIn || !s.punchOut) return; // only closed sessions
      const startMs = s.punchIn?.toDate ? s.punchIn.toDate().getTime() : (typeof s.punchIn === 'string' ? Date.parse(s.punchIn) : s.punchIn);
      const endMs = s.punchOut?.toDate ? s.punchOut.toDate().getTime() : (typeof s.punchOut === 'string' ? Date.parse(s.punchOut) : s.punchOut);
      if (typeof startMs !== 'number' || typeof endMs !== 'number' || endMs <= startMs) return;
      const d = new Date(startMs);
      const key = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
      map.set(key, (map.get(key)||0) + (endMs - startMs));
    });
    const rows = Array.from(map.entries())
      .sort((a,b)=> a[0].localeCompare(b[0]))
      .map(([date, totalMs]) => {
        const parts = date.split('-');
        const display = new Date(Number(parts[0]), Number(parts[1])-1, Number(parts[2])).toLocaleDateString(undefined, { day:'2-digit', month:'2-digit', year:'numeric' });
        const h = Math.floor(totalMs/3600000);
        const m = Math.floor((totalMs%3600000)/60000);
        return { date, dateDisplay: display, totalMs, human: `${h}h ${m}m`, decimal: totalMs/3600000 };
      });
    return rows;
  }

  private buildGrouped(list: any[]) {
    const map = new Map<string, { dateKey:string; dateDisplay:string; totalMs:number; sessions:any[] }>();
    list.forEach(s => {
      const startMs = s.punchIn?.toDate ? s.punchIn.toDate().getTime() : (typeof s.punchIn === 'string' ? Date.parse(s.punchIn) : s.punchIn);
      if (!startMs || isNaN(startMs)) return;
      const d = new Date(startMs);
      const key = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
      let entry = map.get(key);
      if (!entry) {
        entry = {
          dateKey: key,
          dateDisplay: d.toLocaleDateString(undefined,{ day:'2-digit', month:'2-digit', year:'numeric' }),
          totalMs: 0,
          sessions: []
        };
        map.set(key, entry);
      }
      // accumulate closed duration
      if (s.punchOut) {
        const endMs = s.punchOut?.toDate ? s.punchOut.toDate().getTime() : (typeof s.punchOut === 'string' ? Date.parse(s.punchOut) : s.punchOut);
        if (typeof endMs === 'number' && endMs > startMs) entry.totalMs += (endMs - startMs);
      }
      entry.sessions.push(s);
    });
    const rows = Array.from(map.values());
    // sort sessions inside each group: active first then by punchIn desc
    rows.forEach(r => {
      r.sessions.sort((a,b)=> {
        const aActive = !a.punchOut; const bActive = !b.punchOut;
        if (aActive && !bActive) return -1;
        if (!aActive && bActive) return 1;
        const aStart = a.punchIn?.toDate ? a.punchIn.toDate().getTime() : (typeof a.punchIn === 'string' ? Date.parse(a.punchIn) : a.punchIn);
        const bStart = b.punchIn?.toDate ? b.punchIn.toDate().getTime() : (typeof b.punchIn === 'string' ? Date.parse(b.punchIn) : b.punchIn);
        return (bStart||0) - (aStart||0);
      });
    });
    // sort groups by date descending (most recent day first)
    rows.sort((a,b)=> b.dateKey.localeCompare(a.dateKey));
    return rows;
  }
}
