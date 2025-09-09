import { Component, signal, computed, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonContent, IonButton, IonCard, IonCardHeader, IonCardTitle, IonCardContent, IonText, IonSpinner, IonList, IonItem, IonLabel, IonBadge, IonGrid, IonCol, IonRow, IonSkeletonText, IonIcon } from '@ionic/angular/standalone';
import { PunchService } from '../services/punch.service';
import { PerfService } from '../metrics/perf.service';
import { AuthService } from '../services/auth.service';
import { OfflineQueueService } from '../services/offline-queue.service';
import { CompanyService } from '../services/company.service';
import { Firestore, doc, getDoc } from '@angular/fire/firestore';
import { Auth, authState } from '@angular/fire/auth';
import { Router, NavigationEnd } from '@angular/router';
import { filter, Subject, takeUntil, interval, switchMap, from } from 'rxjs';

@Component({
  selector: 'app-tab1',
  templateUrl: 'tab1.page.html',
  styleUrls: ['tab1.page.scss'],
  imports: [CommonModule, IonContent, IonButton, IonCard, IonCardHeader, IonCardTitle, IonCardContent, IonText, IonSpinner, IonList, IonItem, IonLabel, IonBadge, IonGrid, IonCol, IonRow, IonSkeletonText, IonIcon],
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
  // Dynamic computed daily total including active session live updates
  workedTodayMs = computed(() => {
    const sessions = this.todaySessions();
    let total = 0;
    sessions.forEach(s => {
      const start = s.punchIn?.toDate ? s.punchIn.toDate().getTime() : (s.punchIn ? new Date(s.punchIn).getTime() : null);
      if (!start) return;
      if (s.punchOut) {
        const end = s.punchOut?.toDate ? s.punchOut.toDate().getTime() : new Date(s.punchOut).getTime();
        total += Math.max(0, end - start);
      } else {
        // active session use current durationMs if present to avoid double calc jitter
        if (typeof s.durationMs === 'number' && s.durationMs > 0) {
          total += s.durationMs;
        } else {
          total += Date.now() - start;
        }
      }
    });
    return total;
  });

  // Alternate total based on company punches filtered to current user (covers any missed sessions)
  companyWorkedTodayMs = computed(() => {
    const list = this.myCompanyTodayPunches();
    if (!list.length) return this.workedTodayMs(); // fallback
    let total = 0;
    list.forEach(r => {
      const start = r.punchIn?.toDate ? r.punchIn.toDate().getTime() : (typeof r.punchIn === 'string' ? Date.parse(r.punchIn) : r.punchIn);
      if (!start || isNaN(start)) return;
      if (r.punchOut) {
        const end = r.punchOut?.toDate ? r.punchOut.toDate().getTime() : (typeof r.punchOut === 'string' ? Date.parse(r.punchOut) : r.punchOut);
        if (end && !isNaN(end) && end > start) total += (end - start);
      } else {
        total += Math.max(0, Date.now() - start);
      }
    });
    return total;
  });

  activeStartTime = computed(() => {
    if (!this.punchInStartISO) return null;
    try {
      return new Date(this.punchInStartISO).toLocaleTimeString(undefined,{ hour:'2-digit', minute:'2-digit' });
    } catch { return null; }
  });
  history = signal<any[]>([]);
  offlineTasks = signal(0);
  todaySessions = signal<any[]>([]);
  companyTodayPunches = signal<any[]>([]);
  // Current authenticated user id (tracked for filtering)
  userId = signal<string | null>(null);
  userProfile = signal<any | null>(null);
  // Filtered list: only this user's punches from companyTodayPunches
  myCompanyTodayPunches = computed(() => {
    const uid = this.userId();
    if (!uid) return [];
    return this.companyTodayPunches().filter(r => r.userId === uid);
  });
  // Currently open (no punchOut) record for this user (first found)
  openActivePunch = computed(() => {
    return this.myCompanyTodayPunches().find(r => !r.punchOut) || null;
  });
  // Live duration for active open punch (fallback to existing durationMs then dynamic)
  activeDurationMs = computed(() => {
    const rec: any = this.openActivePunch();
    if (!rec) return 0;
    const start = rec.punchIn?.toDate ? rec.punchIn.toDate().getTime() : (rec.punchIn ? Date.parse(rec.punchIn) : null);
    if (!start || isNaN(start)) return 0;
    if (rec.punchOut) {
      const end = rec.punchOut?.toDate ? rec.punchOut.toDate().getTime() : Date.parse(rec.punchOut);
      return end && end > start ? end - start : 0;
    }
    // prefer rec.durationMs if provided to reduce jitter; otherwise compute now-start
    if (typeof rec.durationMs === 'number' && rec.durationMs > 0) return rec.durationMs;
    return Date.now() - start;
  });
  fullHistory = signal<any[]>([]);
  fullHistoryCursor = signal<string | null>(null);
  fullHistoryLoading = signal(false);
  syncing = signal(false);
  syncResult = signal<string | null>(null);

  constructor(
    private punchService: PunchService,
    private companyService: CompanyService,
    private firestore: Firestore,
  private auth: Auth,
  private authService: AuthService,
  private router: Router,
  private offlineQueue: OfflineQueueService,
  private perf: PerfService,
  ) {}

  get punchedIn() { return this.activeRecordId() !== null; }

  private perfStopped = false;
  private tryStopPerf() {
    if (this.perfStopped) return;
    // Criteria: user profile loaded & at least attempted loading company punches
    if (this.userProfile() && this.companyTodayPunches()) {
      this.perf.stop('startup_to_dashboard');
      this.perfStopped = true;
    }
  }

  toggleReducedMotion() {
    const cls = 'reduce-motion';
    document.body.classList.toggle(cls);
  }

  async ngOnInit() {
    // Zone-aware auth state observable (prevents outside injection context warnings)
    authState(this.auth).pipe(takeUntil(this.destroyed$)).subscribe(async user => {
      if (user) {
        this.userId.set(user.uid);
  await this.loadUserProfile(user.uid);
        await this.restoreSessionFull();
        await this.refreshTodayTotal();
        await this.refreshTodaySessions();
        await this.refreshCompanyTodayPunches(); // ensure My Punches loads immediately
  this.tryStopPerf();
      } else {
        this.userId.set(null);
        this.activeRecordId.set(null);
        this.clearElapsedTimer();
        this.message.set(null);
        this.companyTodayPunches.set([]);
  this.userProfile.set(null);
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
  await this.refreshCompanyTodayPunches();
    this.refreshOfflineCount();
      }
    });

  // Start watching history (simple one-time subscription with refresh logic)
  this.initHistoryWatcher();
  await this.refreshTodayTotal();
  await this.refreshTodaySessions();
  await this.refreshCompanyTodayPunches();
  this.refreshOfflineCount();
  // Load initial full history (paged)
  this.loadInitialFullHistory();
  // Poll company punches every 60s using RxJS inside Angular injection/zone context
  interval(60000).pipe(
    takeUntil(this.destroyed$),
    switchMap(() => from(this.punchService.getTodayCompanyPunches()))
  ).subscribe(list => this.companyTodayPunches.set(list));
  }

  async loadInitialFullHistory() {
    if (this.fullHistoryLoading()) return;
    this.fullHistoryLoading.set(true);
    try {
      const { items, nextCursor } = await this.punchService.getUserPunchesPage(25);
      this.fullHistory.set(items);
      this.fullHistoryCursor.set(nextCursor || null);
    } finally {
      this.fullHistoryLoading.set(false);
    }
  }

  async loadMoreFullHistory() {
    if (this.fullHistoryLoading() || !this.fullHistoryCursor()) return;
    this.fullHistoryLoading.set(true);
    try {
      const { items, nextCursor } = await this.punchService.getUserPunchesPage(25, this.fullHistoryCursor()!);
      this.fullHistory.set([...this.fullHistory(), ...items]);
      this.fullHistoryCursor.set(nextCursor || null);
    } finally {
      this.fullHistoryLoading.set(false);
    }
  }

  formatDateTime(dt?: string) {
    if (!dt) return '?';
    const d = new Date(dt);
    return d.toLocaleDateString(undefined,{ month:'short', day:'2-digit' }) + ' ' + d.toLocaleTimeString(undefined,{ hour:'2-digit', minute:'2-digit' });
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
  this.setActiveStartMessage(companyName || undefined);
    } catch (e: any) {
      this.message.set(e.message || 'Punch in failed');
      if (e.message && e.message.includes('Failed to fetch')) {
        this.queueOffline('punchIn', {});
      }
    } finally {
      this.loading.set(false);
      await this.refreshTodayTotal();
  await this.refreshTodaySessions();
  await this.refreshCompanyTodayPunches();
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
  await this.refreshCompanyTodayPunches();
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
          const raw = pData?.punchIn;
          if (raw) {
            try {
              if (typeof raw?.toDate === 'function') {
                punchInISO = raw.toDate().toISOString();
              } else if (raw instanceof Date) {
                punchInISO = raw.toISOString();
              } else if (typeof raw === 'string') {
                punchInISO = raw; // legacy ISO
              }
            } catch {
              // ignore conversion errors
              punchInISO = null;
            }
          }
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
  this.setActiveStartMessage(companyName || undefined);
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
  this.setActiveStartMessage(companyName || undefined);
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
      // Initial load fallback (immediate)
      const sessions = await this.punchService.getTodaySessions();
      this.todaySessions.set(sessions);
  this.tryStopPerf();
      // Start real-time subscription (only once)
      if (!(this as any)._todayWatcherStarted) {
        (this as any)._todayWatcherStarted = true;
        this.punchService.watchTodayUserPunches()
          .pipe(takeUntil(this.destroyed$))
          .subscribe(list => {
            // Keep current active session elapsed timer separate; durations will be recalculated each emission
            this.todaySessions.set(list);
    this.tryStopPerf();
          });
      }
    } catch { /* ignore */ }
  }

  private async refreshCompanyTodayPunches() {
    try {
      const list = await this.punchService.getTodayCompanyPunches();
      this.companyTodayPunches.set(list);
  this.tryStopPerf();
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

  formatHm(ms: number): string {
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    return `${h}h ${m}m`;
  }

  private queueOffline(type: 'punchIn'|'punchOut', payload: any) {
    this.offlineQueue.enqueue({ type, payload });
    this.refreshOfflineCount();
  }

  private refreshOfflineCount() {
    this.offlineTasks.set(this.offlineQueue.peekAll().length);
  }

  private async loadUserProfile(uid: string) {
    try {
      const snap = await getDoc(doc(this.firestore, 'users', uid));
      if (snap.exists()) {
        this.userProfile.set(snap.data());
      } else {
        this.userProfile.set(null);
      }
    } catch {
      this.userProfile.set(null);
    }
  }

  private setActiveStartMessage(companyName?: string) {
    this.message.set('Syif bermula. Rondaan awal, periksa akses & pintu, pantau CCTV, periksa store, catat pemerhatian.');
  }

  ngOnDestroy(): void {
    this.destroyed$.next();
    this.destroyed$.complete();
    this.clearElapsedTimer();
  }

  async logout() {
    try {
      await this.authService.logout();
    } catch (e) {
      // ignore
    } finally {
      this.activeRecordId.set(null);
      this.clearElapsedTimer();
      this.message.set(null);
      this.router.navigateByUrl('/login');
    }
  }
}
