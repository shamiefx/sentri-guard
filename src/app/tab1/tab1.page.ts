import { Component, signal, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonHeader, IonToolbar, IonTitle, IonContent, IonButton, IonCard, IonCardHeader, IonCardTitle, IonCardContent, IonCardSubtitle, IonText, IonSpinner, IonList, IonItem, IonLabel } from '@ionic/angular/standalone';
import { PunchService } from '../services/punch.service';
import { OfflineQueueService } from '../services/offline-queue.service';
import { CompanyService } from '../services/company.service';
import { Firestore, doc, getDoc } from '@angular/fire/firestore';
import { Auth, onAuthStateChanged } from '@angular/fire/auth';
import { Router, NavigationEnd } from '@angular/router';
import { filter, Subject, takeUntil } from 'rxjs';

@Component({
  selector: 'app-tab1',
  templateUrl: 'tab1.page.html',
  styleUrls: ['tab1.page.scss'],
  imports: [CommonModule, IonHeader, IonToolbar, IonTitle, IonContent, IonButton, IonCard, IonCardHeader, IonCardTitle, IonCardContent, IonCardSubtitle, IonText, IonSpinner, IonList, IonItem, IonLabel],
})
export class Tab1Page implements OnInit, OnDestroy {
  private activeRecordId = signal<string | null>(null);
  loading = signal(false);
  message = signal<string | null>(null);
  elapsedDisplay = signal<string>('');
  private punchInStartISO: string | null = null;
  private timerHandle: any = null;
  private destroyed$ = new Subject<void>();
  todayTotalMs = signal(0);
  history = signal<any[]>([]);
  offlineTasks = signal(0);
  todaySessions = signal<any[]>([]);
  syncing = signal(false);
  syncResult = signal<string | null>(null);

  constructor(
    private punchService: PunchService,
    private companyService: CompanyService,
    private firestore: Firestore,
    private auth: Auth,
  private router: Router,
  private offlineQueue: OfflineQueueService,
  ) {}

  get punchedIn() { return this.activeRecordId() !== null; }

  async ngOnInit() {
    // Auth state listener ensures we restore after a hard refresh once user is available
    onAuthStateChanged(this.auth, async (user) => {
      if (user) {
        await this.restoreSessionFull();
      } else {
        // User signed out; reset state
        this.activeRecordId.set(null);
        this.clearElapsedTimer();
        this.message.set(null);
      }
    });

    // Re-check when navigating back to this tab
    this.router.events.pipe(
      filter(e => e instanceof NavigationEnd),
      takeUntil(this.destroyed$)
    ).subscribe(async (e: any) => {
      if (e.urlAfterRedirects?.includes('/tabs/tab1')) {
        await this.refreshOpenSession();
    await this.refreshTodayTotal();
  await this.refreshTodaySessions();
    this.refreshOfflineCount();
      }
    });

  // Start watching history (simple one-time subscription with refresh logic)
  this.initHistoryWatcher();
  await this.refreshTodayTotal();
  await this.refreshTodaySessions();
  this.refreshOfflineCount();
  }

  async punchIn() {
    this.loading.set(true);
    this.message.set(null);
    try {
      const id = await this.punchService.punchIn();
      this.activeRecordId.set(id);
  const { companyName, punchInISO } = await this.resolveCompanyContext(id);
  this.punchInStartISO = punchInISO;
  this.startElapsedTimer();
  this.message.set(companyName ? `You are punche attendance at ${companyName}` : 'You are punche attendance');
    } catch (e: any) {
      this.message.set(e.message || 'Punch in failed');
      if (e.message && e.message.includes('Failed to fetch')) {
        this.queueOffline('punchIn', {});
      }
    } finally {
      this.loading.set(false);
      await this.refreshTodayTotal();
  await this.refreshTodaySessions();
    }
  }

  async punchOut() {
    if (!this.activeRecordId()) return;
    this.loading.set(true);
    this.message.set(null);
    try {
      await this.punchService.punchOut(this.activeRecordId()!);
  this.message.set('Punched out successfully');
      this.activeRecordId.set(null);
  this.clearElapsedTimer();
    } catch (e: any) {
      this.message.set(e.message || 'Punch out failed');
      if (e.message && e.message.includes('Failed to fetch')) {
        this.queueOffline('punchOut', { recordId: this.activeRecordId() });
      }
    } finally {
      this.loading.set(false);
      await this.refreshTodayTotal();
  await this.refreshTodaySessions();
    }
  }

  async syncNow() {
    if (this.syncing()) return;
    this.syncing.set(true);
    this.syncResult.set(null);
    try {
      const summary = await this.offlineQueue.process({
        punchIn: async () => {
          // Re-run punchIn (no payload specifics needed currently)
          await this.punchService.punchIn();
        },
        punchOut: async (payload:any) => {
          if (payload?.recordId) {
            await this.punchService.punchOut(payload.recordId);
          }
        }
      });
      this.syncResult.set(`Synced: ${summary.processed} (errors: ${summary.errors}, remaining: ${summary.remaining})`);
      await this.refreshTodayTotal();
      this.refreshOfflineCount();
    } catch (e:any) {
      this.syncResult.set(e.message || 'Sync failed');
    } finally {
      this.syncing.set(false);
    }
  }

  private async resolveCompanyContext(punchId?: string): Promise<{ companyName: string | null; punchInISO: string | null }> {
    const user = this.auth.currentUser;
    if (!user) return { companyName: null, punchInISO: null };
    try {
      const userSnap = await getDoc(doc(this.firestore, 'users', user.uid));
      const userData: any = userSnap.exists() ? userSnap.data() : {};
      const code = userData?.companyCode;
      let companyName: string | null = null;
      if (code) {
        const company = await this.companyService.getCompanyByCode(code);
        companyName = company?.name || company?.companyCode || null;
      }
      let punchInISO: string | null = null;
      if (punchId) {
        const punchSnap = await getDoc(doc(this.firestore, 'punches', punchId));
        if (punchSnap.exists()) {
          const pData: any = punchSnap.data();
            punchInISO = pData?.punchIn || null;
        }
      }
      return { companyName, punchInISO };
    } catch {
      return { companyName: null, punchInISO: null };
    }
  }

  private startElapsedTimer() {
    this.clearElapsedTimer();
    if (!this.punchInStartISO) return;
    const update = () => {
      this.elapsedDisplay.set(this.formatElapsed(this.punchInStartISO!));
  this.updateActiveSessionDurationInList();
    };
    update();
    this.timerHandle = setInterval(update, 1000);
  }

  private clearElapsedTimer() {
    if (this.timerHandle) {
      clearInterval(this.timerHandle);
      this.timerHandle = null;
    }
    this.elapsedDisplay.set('');
    this.punchInStartISO = null;
  }

  private formatElapsed(startISO: string): string {
    const start = new Date(startISO).getTime();
    const diff = Math.max(0, Date.now() - start);
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
  }

  private async refreshOpenSession() {
    if (this.activeRecordId()) return; // already have one
    const openId = await this.punchService.getOpenPunchId();
    if (openId) {
      this.activeRecordId.set(openId);
      const { companyName, punchInISO } = await this.resolveCompanyContext(openId);
      this.punchInStartISO = punchInISO;
      this.startElapsedTimer();
      this.message.set(companyName ? `You are punche attendance at ${companyName}` : 'You are punche attendance');
    }
  }

  private async restoreSessionFull() {
    try {
      const openId = await this.punchService.getOpenPunchId();
      if (!openId) return;
      this.activeRecordId.set(openId);
      const { companyName, punchInISO } = await this.resolveCompanyContext(openId);
      this.punchInStartISO = punchInISO;
      this.startElapsedTimer();
      this.message.set(companyName ? `You are punche attendance at ${companyName}` : 'You are punche attendance');
    } catch (e:any) {
      // eslint-disable-next-line no-console
      console.warn('Session restore failed', e.message);
    }
  }

  private async refreshTodayTotal() {
    try {
      const ms = await this.punchService.getTodayTotalMs();
      this.todayTotalMs.set(ms);
    } catch { /* ignore */ }
  }

  private async refreshTodaySessions() {
    try {
      const sessions = await this.punchService.getTodaySessions();
      this.todaySessions.set(sessions);
    } catch { /* ignore */ }
  }

  private updateActiveSessionDurationInList() {
    if (!this.activeRecordId()) return;
    const sessions = this.todaySessions();
    const idx = sessions.findIndex(s => s.id === this.activeRecordId() && !s.punchOut);
    if (idx === -1) return;
    const s = sessions[idx];
    const punchInTime = s.punchIn?.toDate ? s.punchIn.toDate().getTime() : new Date(s.punchIn).getTime();
    if (isNaN(punchInTime)) return;
    const newDuration = Date.now() - punchInTime;
    if (Math.abs(newDuration - s.durationMs) < 900) return; // skip tiny changes to reduce churn
    const updated = [...sessions];
    updated[idx] = { ...s, durationMs: newDuration };
    this.todaySessions.set(updated);
  }

  private initHistoryWatcher() {
    const obs = this.punchService.watchRecentPunches();
    obs.pipe(takeUntil(this.destroyed$)).subscribe(list => {
      this.history.set(list);
    });
  }

  formatMs(ms: number): string {
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
  }

  private queueOffline(type: 'punchIn'|'punchOut', payload: any) {
    this.offlineQueue.enqueue({ type, payload });
    this.refreshOfflineCount();
  }

  private refreshOfflineCount() {
    this.offlineTasks.set(this.offlineQueue.peekAll().length);
  }

  ngOnDestroy(): void {
    this.destroyed$.next();
    this.destroyed$.complete();
    this.clearElapsedTimer();
  }
}
