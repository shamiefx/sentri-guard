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

  constructor(private punchService: PunchService) {}

  ionViewWillEnter() {
    this.refresh();
  }

  async refresh() {
    this.loading.set(true);
    this.error.set(null);
    try {
      const open = await this.punchService.getOpenPunchWithCheckpoints();
      if (!open) {
        this.activeSessionId.set(null);
        this.checkpoints.set([]);
        this.sessionClosed.set(false);
        return;
      }
      this.activeSessionId.set(open.id);
      this.sessionClosed.set(!!open.punchOut);
      this.checkpoints.set(open.checkpoints || []);
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

}
