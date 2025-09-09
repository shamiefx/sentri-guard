import { Component, signal } from '@angular/core';
import { getStorage, ref, getDownloadURL } from '@angular/fire/storage';
import { CommonModule } from '@angular/common';
import { IonHeader, IonToolbar, IonTitle, IonContent, IonButton, IonCard, IonCardHeader, IonCardTitle, IonCardContent, IonList, IonItem, IonLabel, IonSpinner, IonText, IonBadge, IonIcon } from '@ionic/angular/standalone';
import { PunchService, PunchCheckpoint } from '../services/punch.service';

@Component({
  selector: 'app-tab2',
  templateUrl: 'tab2.page.html',
  styleUrls: ['tab2.page.scss'],
  imports: [CommonModule, IonHeader, IonToolbar, IonTitle, IonContent, IonButton, IonCard, IonCardHeader, IonCardTitle, IonCardContent, IonList, IonItem, IonLabel, IonSpinner, IonText, IonBadge, IonIcon]
})
export class Tab2Page {
  loading = signal(false);
  error = signal<string | null>(null);
  checkpoints = signal<PunchCheckpoint[]>([]);
  activeSessionId = signal<string | null>(null);
  sessionClosed = signal(false);
  showingHistory = signal(false);
  recentSessions = signal<any[]>([]);
  selectedHistorySession = signal<any | null>(null);

  constructor(private punchService: PunchService) {}

  ionViewWillEnter() {
    this.refresh();
  }

  async refresh() {
    this.loading.set(true);
    this.error.set(null);
    try {
      // First attempt to load open session
      const open = await this.punchService.getOpenPunchWithCheckpoints();
      if (open) {
        this.activeSessionId.set(open.id);
        this.sessionClosed.set(!!open.punchOut);
  this.checkpoints.set(await this.enrichCheckpoints(open.checkpoints || []));
      } else {
        // fallback: last closed session
        const lastClosed = await this.punchService.getLastClosedPunchWithCheckpoints();
        if (lastClosed) {
          this.activeSessionId.set(lastClosed.id);
          this.sessionClosed.set(true);
          this.checkpoints.set(await this.enrichCheckpoints(lastClosed.checkpoints || []));
        } else {
          this.activeSessionId.set(null);
          this.sessionClosed.set(false);
          this.checkpoints.set([]);
  }
      }
    } catch (e:any) {
      this.error.set(e.message || 'Failed to load');
    } finally {
      this.loading.set(false);
    }
  }

  async addCheckpoint() {
    this.loading.set(true);
    this.error.set(null);
    try {
      const cp = await this.punchService.addCheckpoint();
  this.checkpoints.set([...(this.checkpoints()), ...(await this.enrichCheckpoints([cp]))]);
    } catch (e:any) {
      this.error.set(e.message || 'Add failed');
    } finally {
      this.loading.set(false);
    }
  }

  async toggleHistory() {
    this.showingHistory.set(!this.showingHistory());
    if (this.showingHistory() && this.recentSessions().length === 0) {
      try {
        this.loading.set(true);
        const list = await this.punchService.getRecentClosedPunches(10);
        this.recentSessions.set(list);
      } catch (e:any) {
        this.error.set(e.message || 'Failed to load history');
      } finally {
        this.loading.set(false);
      }
    }
  }

  selectHistorySession(session: any) {
    // Enrich checkpoints with URLs if needed
    if (session?.checkpoints?.length) {
      this.enrichCheckpoints(session.checkpoints).then(enriched => {
        session.checkpoints = enriched;
        this.selectedHistorySession.set({ ...session });
      });
    } else {
      this.selectedHistorySession.set(session);
    }
  }

  closeHistoryDetail() {
    this.selectedHistorySession.set(null);
  }

  private async enrichCheckpoints(list: PunchCheckpoint[]): Promise<PunchCheckpoint[]> {
    const storage = getStorage();
    const out: PunchCheckpoint[] = [];
    for (const cp of list) {
      if (!cp.photoUrl && cp.photoPath) {
        try { cp.photoUrl = await getDownloadURL(ref(storage, cp.photoPath)); } catch { /* ignore */ }
      }
      out.push(cp);
    }
    return out;
  }

  // Helpers for session detail display
  sessionStartMs(s: any): number | null {
    if (!s?.punchIn) return null;
    try {
      if (typeof s.punchIn?.toDate === 'function') return s.punchIn.toDate().getTime();
      if (s.punchIn instanceof Date) return s.punchIn.getTime();
      if (typeof s.punchIn === 'string') { const t = Date.parse(s.punchIn); return isNaN(t)? null : t; }
      if (typeof s.punchIn === 'number') return s.punchIn;
    } catch { return null; }
    return null;
  }
  sessionEndMs(s: any): number | null {
    if (!s?.punchOut) return null;
    try {
      if (typeof s.punchOut?.toDate === 'function') return s.punchOut.toDate().getTime();
      if (s.punchOut instanceof Date) return s.punchOut.getTime();
      if (typeof s.punchOut === 'string') { const t = Date.parse(s.punchOut); return isNaN(t)? null : t; }
      if (typeof s.punchOut === 'number') return s.punchOut;
    } catch { return null; }
    return null;
  }
  sessionDurationMs(s: any): number {
    const start = this.sessionStartMs(s);
    const end = this.sessionEndMs(s);
    if (start && end && end > start) return end - start;
    if (start && !end) return Date.now() - start;
    return 0;
  }
  formatMs(ms: number): string {
    const h = Math.floor(ms/3600000);
    const m = Math.floor((ms%3600000)/60000);
    return `${h}h ${m}m`;
  }

}
