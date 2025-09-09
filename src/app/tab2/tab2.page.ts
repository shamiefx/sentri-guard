import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonHeader, IonToolbar, IonTitle, IonContent, IonButton, IonCard, IonCardHeader, IonCardTitle, IonCardContent, IonList, IonItem, IonLabel, IonSpinner, IonText, IonBadge } from '@ionic/angular/standalone';
import { PunchService, PunchCheckpoint } from '../services/punch.service';

@Component({
  selector: 'app-tab2',
  templateUrl: 'tab2.page.html',
  styleUrls: ['tab2.page.scss'],
  imports: [CommonModule, IonHeader, IonToolbar, IonTitle, IonContent, IonButton, IonCard, IonCardHeader, IonCardTitle, IonCardContent, IonList, IonItem, IonLabel, IonSpinner, IonText, IonBadge]
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
        this.checkpoints.set(open.checkpoints || []);
      } else {
        // fallback: last closed session
        const lastClosed = await this.punchService.getLastClosedPunchWithCheckpoints();
        if (lastClosed) {
          this.activeSessionId.set(lastClosed.id);
          this.sessionClosed.set(true);
          this.checkpoints.set(lastClosed.checkpoints || []);
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
      this.checkpoints.set([...this.checkpoints(), cp]);
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
    this.selectedHistorySession.set(session);
  }

  closeHistoryDetail() {
    this.selectedHistorySession.set(null);
  }

}
