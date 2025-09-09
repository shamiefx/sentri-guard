
import { Injectable, inject, runInInjectionContext, EnvironmentInjector } from '@angular/core';
import { Auth, user } from '@angular/fire/auth';
import { Firestore, addDoc, collection, doc, serverTimestamp, updateDoc, getDoc, query, where, limit, getDocs, orderBy, collectionData, startAfter, deleteField } from '@angular/fire/firestore';
import { getStorage, ref, uploadString, getDownloadURL } from '@angular/fire/storage';
import { Observable, map, firstValueFrom } from 'rxjs';
import { Geolocation } from '@capacitor/geolocation';
import { Camera, CameraResultType, CameraSource, CameraDirection } from '@capacitor/camera';

export interface PunchRecord {
  userId: string;
  companyCode?: string;
  staffId?: string;
  email?: string;
  // punchIn / punchOut now stored as Firestore Timestamp (Date) going forward.
  // Legacy documents may still have ISO string values; code handles both.
  punchIn?: any; // Firestore Timestamp | Date | string
  punchInLocation?: { lat: number; lng: number; accuracy?: number };
  punchInPhotoPath?: string; // storage path
  punchInPhotoUrl?: string; // optional cached URL
  punchOut?: any | null; // Firestore Timestamp | Date | string | null
  punchOutLocation?: { lat: number; lng: number; accuracy?: number };
  punchOutPhotoPath?: string;
  punchOutPhotoUrl?: string;
  createdAt?: any;
  updatedAt?: any;
  // Embedded checkpoints (keep count modest to avoid 1MB doc size limit)
  checkpoints?: PunchCheckpoint[];
}

export interface PunchCheckpoint {
  id: string;
  createdAt: string; // ISO timestamp
  location: { lat: number; lng: number; accuracy?: number };
  photoPath?: string;
  photoUrl?: string;
}

@Injectable({ providedIn: 'root' })
export class PunchService {
  /** Fetch all punches for current user (for debug/fallback). */
  async getAllPunchesForUser(): Promise<any[]> {
    const user = this.auth.currentUser; if (!user) return [];
    const colRef = collection(this.firestore, 'punches');
    const snap = await getDocs(query(colRef, where('userId','==', user.uid), limit(2000)));
    const arr: any[] = [];
    snap.forEach(d => arr.push(d.data()));
    return arr;
  }
  private firestore = inject(Firestore);
  private auth = inject<Auth>(Auth as any);
  private injector = inject(EnvironmentInjector);
  // Maximum dimension (width or height) for uploaded images (medium ~1K px)
  private readonly MAX_IMAGE_DIMENSION = 1000;
  // Helper: safely convert Firestore Timestamp / Date / string to epoch ms
  getTimeMs(v: any | null | undefined): number | null {
    if (!v) return null;
    // Firestore Timestamp objects have toDate()
    try {
      if (typeof v.toDate === 'function') {
        return v.toDate().getTime();
      }
    } catch { /* ignore */ }
    if (v instanceof Date) return v.getTime();
    if (typeof v === 'string') {
      const t = Date.parse(v);
      return isNaN(t) ? null : t;
    }
    return null;
  }

  async captureLocation(): Promise<{ lat: number; lng: number; accuracy?: number }> {
    const position = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 15000 });
    return { lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy };
  }

  async capturePhotoFrontAndResize(): Promise<string> {
    // Capture front camera photo. We request a large size then downscale to a medium 1000px max dimension.
    // Using explicit width/height helps some platforms deliver an already resized image.
    const photo = await Camera.getPhoto({
      resultType: CameraResultType.DataUrl,
      source: CameraSource.Camera,
      direction: CameraDirection.Front,
      quality: 70, // slightly higher since we rely on Storage now
      width: this.MAX_IMAGE_DIMENSION,
      height: this.MAX_IMAGE_DIMENSION,
      allowEditing: false,
    });
    const dataUrl = photo.dataUrl || '';
    // Downscale (or keep) to <= 1000px longest side to control file size (roughly "medium" quality)
    try {
      const resized = await this.downscaleDataUrl(dataUrl, this.MAX_IMAGE_DIMENSION);
      return resized;
    } catch {
      return dataUrl; // fallback if resize fails
    }
  }

  private downscaleDataUrl(dataUrl: string, max: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let { width, height } = img;
        const scale = Math.min(1, max / Math.max(width, height));
        width = Math.round(width * scale);
        height = Math.round(height * scale);
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) { reject('No ctx'); return; }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.6));
      };
      img.onerror = reject;
      img.src = dataUrl;
    });
  }

  private async uploadDataUrl(storagePath: string, dataUrl: string): Promise<{ path: string; url: string | null }> {
    try {
      const storage = getStorage();
      const r = ref(storage, storagePath);
      await uploadString(r, dataUrl, 'data_url');
      let url: string | null = null;
      try { url = await getDownloadURL(r); } catch { url = null; }
      return { path: storagePath, url };
    } catch {
      return { path: storagePath, url: null };
    }
  }

  /** Returns the open punch record id (if any) for the current user. */
  async getOpenPunchId(): Promise<string | null> {
    const user = this.auth.currentUser;
    if (!user) return null;
    try {
      const colRef = collection(this.firestore, 'punches');
      const qRef = query(colRef, where('userId', '==', user.uid), where('punchOut', '==', null), limit(1));
      const rows: any[] = await firstValueFrom(collectionData(qRef, { idField: 'id' }));
      if (!rows.length) return null;
      return rows[0].id;
    } catch {
      // fallback to one-time getDocs if observable path fails
      const colRef = collection(this.firestore, 'punches');
      const qRef = query(colRef, where('userId', '==', user.uid), where('punchOut', '==', null), limit(1));
      const snap = await getDocs(qRef);
      if (snap.empty) return null;
      return snap.docs[0].id;
    }
  }

  /** Punch in: creates a new record (only if none open) */
  async punchIn(companyCode?: string) {
    const user = this.auth.currentUser;
    if (!user) throw new Error('Not authenticated');
    const existing = await this.getOpenPunchId();
    if (existing) {
      throw new Error('You already have an active session. Punch out first.');
    }
  // 1. Capture selfie (front camera) 2. Get location 3. Store
  const photoDataUrl = await this.capturePhotoFrontAndResize();
  const location = await this.captureLocation();
  const tsIn = Date.now();
  const uploadIn = await this.uploadDataUrl(`punches/${user.uid}/${tsIn}_in.jpg`, photoDataUrl);
  // Fallback: derive companyCode from user profile if not provided
    let finalCompanyCode = companyCode;
    let staffId: string | undefined;
    let email: string | undefined = user.email || undefined;
    try {
      const userProfileRef = doc(this.firestore, 'users', user.uid);
      const snap = await getDoc(userProfileRef);
      if (snap.exists()) {
        const profile: any = snap.data();
        finalCompanyCode = finalCompanyCode || profile.companyCode || undefined;
        staffId = profile.staffId || undefined;
      }
    } catch {
      // ignore profile fetch errors
    }
  await this.validateGeofence(location, finalCompanyCode);
    const punch: PunchRecord = {
      userId: user.uid,
      punchIn: new Date(),
      punchInLocation: location,
  punchInPhotoPath: uploadIn.path,
  ...(uploadIn.url ? { punchInPhotoUrl: uploadIn.url } : {}),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      punchOut: null,
      checkpoints: [],
      ...(finalCompanyCode ? { companyCode: finalCompanyCode } : {})
      , ...(staffId ? { staffId } : {})
      , ...(email ? { email } : {})
    };
    const colRef = collection(this.firestore, 'punches');
    const docRef = await addDoc(colRef, punch as any);
    return docRef.id;
  }

  /** Adds a checkpoint to the currently open punch session (photo + location). */
  async addCheckpoint(): Promise<PunchCheckpoint> {
    const user = this.auth.currentUser; if (!user) throw new Error('Not authenticated');
    const openId = await this.getOpenPunchId();
    if (!openId) throw new Error('No active punch session');
    // Fetch current punch doc
    const ref = doc(this.firestore, 'punches', openId);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error('Session not found');
    const data: any = snap.data();
    if (data.punchOut) throw new Error('Session already closed');
    const checkpoints: PunchCheckpoint[] = Array.isArray(data.checkpoints) ? data.checkpoints : [];
    if (checkpoints.length >= 80) {
      throw new Error('Too many checkpoints (limit ~80 to avoid doc size issues)');
    }
    // Capture photo & location
  const photoDataUrl = await this.capturePhotoFrontAndResize();
  const location = await this.captureLocation();
  const tsCp = Date.now();
  const uploadCp = await this.uploadDataUrl(`punches/${user.uid}/${openId}/checkpoints/${tsCp}_cp.jpg`, photoDataUrl);
    const checkpoint: PunchCheckpoint = {
      id: (globalThis.crypto?.randomUUID?.() || (Date.now().toString(36)+Math.random().toString(36).slice(2,8))),
      createdAt: new Date().toISOString(),
      location,
  photoPath: uploadCp.path,
  ...(uploadCp.url ? { photoUrl: uploadCp.url } : {}),
    };
    const newArray = [...checkpoints, checkpoint];
    await updateDoc(ref, { checkpoints: newArray, updatedAt: serverTimestamp() });
    return checkpoint;
  }

  /** Returns the open punch (if any) including checkpoints. */
  async getOpenPunchWithCheckpoints(): Promise<(PunchRecord & { id:string }) | null> {
    const openId = await this.getOpenPunchId();
    if (!openId) return null;
    const ref = doc(this.firestore, 'punches', openId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    return { id: openId, ...(snap.data() as PunchRecord) };
  }

  /** Fetch the most recent closed punch (punchOut != null) including checkpoints. */
  async getLastClosedPunchWithCheckpoints(): Promise<(PunchRecord & { id:string }) | null> {
    const user = this.auth.currentUser; if (!user) return null;
    try {
      const colRef = collection(this.firestore, 'punches');
      // order by punchOut desc to find latest closed sessions
      const qRef = query(colRef, where('userId','==', user.uid), where('punchOut','!=', null as any), orderBy('punchOut','desc'), limit(1));
      const rows: any[] = await this.safeCollectionData(qRef);
      if (!rows.length) return null;
      return { ...(rows[0] as PunchRecord), id: rows[0].id };
    } catch {
      return null;
    }
  }

  /** Fetch recent (up to N) punch sessions (closed) including checkpoints field for history modal. */
  async getRecentClosedPunches(limitCount = 10): Promise<(PunchRecord & { id:string })[]> {
    const user = this.auth.currentUser; if (!user) return [];
    try {
      const colRef = collection(this.firestore, 'punches');
      const qRef = query(colRef, where('userId','==', user.uid), where('punchOut','!=', null as any), orderBy('punchOut','desc'), limit(limitCount));
      const rows: any[] = await this.safeCollectionData(qRef);
      return rows.map(r => ({ ...(r as PunchRecord), id: r.id }));
    } catch { return []; }
  }

  private async safeCollectionData(qRef: any): Promise<any[]> {
    try {
      return await firstValueFrom(collectionData(qRef, { idField: 'id' }));
    } catch {
      const snap = await getDocs(qRef);
      const arr: any[] = [];
      snap.forEach(d => {
        const data: any = d.data() || {};
        arr.push({ id: d.id, ...data });
      });
      return arr;
    }
  }

  /** Punch out: updates latest open record (no punchOut). */
  async punchOut(recordId: string) {
  const user = this.auth.currentUser;
    if (!user) throw new Error('Not authenticated');
  const photoDataUrl = await this.capturePhotoFrontAndResize();
  const location = await this.captureLocation();
  const tsOut = Date.now();
  const uploadOut = await this.uploadDataUrl(`punches/${user.uid}/${recordId}_out_${tsOut}.jpg`, photoDataUrl);
    // Validate geofence again on punch out
    const userProfileRef = doc(this.firestore, 'users', user.uid);
    let companyCode: string | undefined;
    try {
      const prof = await getDoc(userProfileRef);
      if (prof.exists()) companyCode = (prof.data() as any).companyCode;
    } catch { /* ignore */ }
    await this.validateGeofence(location, companyCode);
    const ref = doc(this.firestore, 'punches', recordId);
    await updateDoc(ref, {
      punchOut: new Date(),
      punchOutLocation: location,
  punchOutPhotoPath: uploadOut.path,
  ...(uploadOut.url ? { punchOutPhotoUrl: uploadOut.url } : {}),
      updatedAt: serverTimestamp(),
    });
  }

  /** Geofence validation: company doc may contain geofenceCenter {lat,lng} and geofenceRadiusMeters */
  private async validateGeofence(location: {lat:number; lng:number}, companyCode?: string | null) {
    if (!companyCode) return; // no geofence
    try {
      const companyRef = doc(this.firestore, 'companies', companyCode);
      const snap = await getDoc(companyRef);
      if (!snap.exists()) return;
      const data: any = snap.data();
      if (!data?.geofenceCenter || !data?.geofenceRadiusMeters) return;
      const center = data.geofenceCenter; // {lat,lng}
      const radius = data.geofenceRadiusMeters; // meters
      if (typeof center.lat !== 'number' || typeof center.lng !== 'number' || typeof radius !== 'number') return;
      const dist = this.haversine(location.lat, location.lng, center.lat, center.lng);
      if (dist > radius) {
        throw new Error(`Outside allowed location (distance ${(dist).toFixed(0)}m > ${radius}m)`);
      }
    } catch (e) {
      if (e instanceof Error) throw e;
    }
  }

  private haversine(lat1:number, lon1:number, lat2:number, lon2:number): number {
    const R = 6371000; // meters
    const toRad = (d:number)=> d * Math.PI/180;
    const dLat = toRad(lat2-lat1);
    const dLon = toRad(lon2-lon1);
    const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  /** Returns observable of recent punches (limit 20) descending by punchIn */
  watchRecentPunches(): Observable<(PunchRecord & { id:string; durationMs:number })[]> {
    const user = this.auth.currentUser;
    if (!user) return new Observable(sub => { sub.next([]); sub.complete(); });
    return runInInjectionContext(this.injector, () => {
      const colRef = collection(this.firestore, 'punches');
      const qRef = query(colRef, where('userId','==', user.uid), orderBy('punchIn','desc'), limit(20));
      return collectionData(qRef, { idField: 'id' }).pipe(
      map((rows: any[]) => rows.map((r: any) => ({
        ...(r as PunchRecord),
        id: r.id,
        durationMs: (() => {
          const start = this.getTimeMs(r.punchIn);
          const end = this.getTimeMs(r.punchOut);
          if (start && end) return end - start;
          return 0;
        })()
      })))
      );
    });
  }

  /** Compute today's total worked milliseconds (completed punches only). */
  async getTodayTotalMs(): Promise<number> {
    const user = this.auth.currentUser; if (!user) return 0;
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(start.getTime() + 86400000);
  // Using Date objects directly (Firestore stores Timestamp)
    // Try ranged query; may require index. Fallback if fails.
    try {
      const colRef = collection(this.firestore, 'punches');
  const qRef = query(colRef, where('userId','==', user.uid), where('punchIn','>=', start), where('punchIn','<', end));
      const snap = await getDocs(qRef);
      let total = 0;
      snap.forEach(d => {
        const data: any = d.data();
  const start = this.getTimeMs(data.punchIn);
  const end = this.getTimeMs(data.punchOut);
  if (start && end) total += (end - start);
      });
      return total;
    } catch {
      return 0; // silent fallback
    }
  }

  /** Fetch all of today's punch sessions (completed or active). */
  async getTodaySessions(): Promise<(PunchRecord & { id:string; durationMs:number })[]> {
    const user = this.auth.currentUser; if (!user) return [];
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(start.getTime() + 86400000);
  // Date range boundaries (local day)
    try {
      const colRef = collection(this.firestore, 'punches');
  const qRef = query(colRef, where('userId','==', user.uid), where('punchIn','>=', start), where('punchIn','<', end), orderBy('punchIn','asc'));
      const snap = await getDocs(qRef);
      const sessions: (PunchRecord & {id:string; durationMs:number})[] = [];
      snap.forEach(d => {
        const data: any = d.data();
  const start = this.getTimeMs(data.punchIn);
  const end = this.getTimeMs(data.punchOut);
  const duration = (start && end) ? (end - start) : (start ? (Date.now() - start) : 0);
        sessions.push({ ...(data as PunchRecord), id: d.id, durationMs: duration });
      });
      if (sessions.length === 0) {
        // Fallback: legacy string punchIn values (different type prevents indexed range match)
        try {
          const broad = await getDocs(query(collection(this.firestore, 'punches'), where('userId','==', user.uid), limit(800)));
          const list: (PunchRecord & {id:string; durationMs:number})[] = [];
          const dayStartMs = start.getTime();
          const dayEndMs = end.getTime();
          broad.forEach(d => {
            const data: any = d.data();
            const pMs = this.getTimeMs(data.punchIn);
            if (pMs == null) return;
            if (pMs < dayStartMs || pMs >= dayEndMs) return;
            const endMs = this.getTimeMs(data.punchOut);
            const duration = (pMs && endMs) ? (endMs - pMs) : (pMs ? (Date.now() - pMs) : 0);
            list.push({ ...(data as PunchRecord), id: d.id, durationMs: duration });
          });
          list.sort((a,b)=> (this.getTimeMs(a.punchIn)! - this.getTimeMs(b.punchIn)!));
          return list;
        } catch { /* ignore */ }
      }
      return sessions;
    } catch {
      return [];
    }
  }

  /** Real-time observable of today's punches for current user (includes active). */
  watchTodayUserPunches(): Observable<(PunchRecord & { id:string; durationMs:number })[]> {
    const user = this.auth.currentUser;
    if (!user) return new Observable(sub => { sub.next([]); sub.complete(); });
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(start.getTime() + 86400000);
    return runInInjectionContext(this.injector, () => {
      const colRef = collection(this.firestore, 'punches');
      const qRef = query(colRef,
        where('userId','==', user.uid),
  where('punchIn','>=', start),
  where('punchIn','<', end),
        orderBy('punchIn','asc')
      );
      return collectionData(qRef, { idField: 'id' }).pipe(
        map((rows: any[]) => rows.map(r => ({
          ...(r as PunchRecord),
          id: (r as any).id,
          durationMs: (() => {
            const start = this.getTimeMs(r.punchIn);
            const end = this.getTimeMs(r.punchOut);
            if (start && end) return end - start;
            if (start) return Date.now() - start;
            return 0;
          })()
        })))
      );
    });
  }

  /** Fetch all punches today for the current user's company (sorted by punchIn asc). */
  async getTodayCompanyPunches(): Promise<(PunchRecord & { id:string; durationMs:number; active:boolean })[]> {
    const user = this.auth.currentUser; if (!user) return [];
    // Determine companyCode from user profile
    let companyCode: string | undefined;
    try {
      const profSnap = await getDoc(doc(this.firestore, 'users', user.uid));
      if (profSnap.exists()) {
        const data: any = profSnap.data();
        companyCode = data.companyCode;
      }
    } catch { /* ignore */ }
    if (!companyCode) return [];
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(start.getTime() + 86400000);
  // Date boundaries for company punches
    try {
      const colRef = collection(this.firestore, 'punches');
      const qRef = query(colRef,
        where('companyCode','==', companyCode),
  where('punchIn','>=', start),
  where('punchIn','<', end),
        orderBy('punchIn','asc')
      );
      const snap = await getDocs(qRef);
      const list: (PunchRecord & { id:string; durationMs:number; active:boolean })[] = [];
      snap.forEach(d => {
        const data: any = d.data();
        const active = !data.punchOut;
  const sMs = this.getTimeMs(data.punchIn);
  const eMs = this.getTimeMs(data.punchOut);
  const duration = (sMs && eMs) ? (eMs - sMs) : (sMs ? (Date.now() - sMs) : 0);
        list.push({ ...(data as PunchRecord), id: d.id, durationMs: duration, active });
      });
      return list;
    } catch (err:any) {
      // Likely missing composite index. Fallback: broad query companyCode only (limited) then client filter.
      try {
        const colRef = collection(this.firestore, 'punches');
        const qRefFallback = query(colRef, where('companyCode','==', companyCode), limit(500));
        const snap = await getDocs(qRefFallback);
        const within: (PunchRecord & { id:string; durationMs:number; active:boolean })[] = [];
        snap.forEach(d => {
          const data: any = d.data();
          if (!data.punchIn) return;
          const pMs = this.getTimeMs(data.punchIn);
          if (pMs == null) return;
          const dayStartMs = start.getTime();
          const dayEndMs = end.getTime();
          if (pMs < dayStartMs || pMs >= dayEndMs) return; // filter to today
          const active = !data.punchOut;
          const sMs = this.getTimeMs(data.punchIn);
          const eMs = this.getTimeMs(data.punchOut);
          const duration = (sMs && eMs) ? (eMs - sMs) : (sMs ? (Date.now() - sMs) : 0);
          within.push({ ...(data as PunchRecord), id: d.id, durationMs: duration, active });
        });
  within.sort((a,b)=> ((this.getTimeMs(a.punchIn)||0) - (this.getTimeMs(b.punchIn)||0)));
        return within;
      } catch {
        return [];
      }
    }
  }

  /** Paginated fetch of user punches (history). Sorted by punchIn desc. */
  async getUserPunchesPage(pageSize = 50, cursorPunchInISO?: string): Promise<{ items:(PunchRecord & {id:string; durationMs:number})[]; nextCursor?: string | null }> {
    const user = this.auth.currentUser; if (!user) return { items: [] };
    try {
      const colRef = collection(this.firestore, 'punches');
      let qRef: any = query(colRef, where('userId','==', user.uid), orderBy('punchIn','desc'), limit(pageSize + 1));
      if (cursorPunchInISO) {
        qRef = query(colRef, where('userId','==', user.uid), orderBy('punchIn','desc'), startAfter(cursorPunchInISO), limit(pageSize + 1));
      }
      const snap = await getDocs(qRef);
      const items: (PunchRecord & {id:string; durationMs:number})[] = [];
      snap.forEach(d => {
        const data: any = d.data();
  const start = this.getTimeMs(data.punchIn);
  const end = this.getTimeMs(data.punchOut);
  const duration = (start && end) ? (end - start) : 0;
        items.push({ ...(data as PunchRecord), id: d.id, durationMs: duration });
      });
      let nextCursor: string | null | undefined = null;
      if (items.length > pageSize) {
        const extra = items.pop(); // remove extra used to detect next page
        nextCursor = extra?.punchIn || null;
      }
      return { items, nextCursor };
    } catch {
      // Fallback: broad query without ordering (may be less efficient) then client sort + slice
      try {
        const colRef = collection(this.firestore, 'punches');
        const broad = await getDocs(query(colRef, where('userId','==', user.uid), limit(1000)));
        let all: (PunchRecord & {id:string; durationMs:number})[] = [];
        broad.forEach(d => {
          const data: any = d.data();
          const start = this.getTimeMs(data.punchIn);
          const end = this.getTimeMs(data.punchOut);
          const duration = (start && end) ? (end - start) : 0;
          all.push({ ...(data as PunchRecord), id: d.id, durationMs: duration });
        });
        all = all.filter(r => r.punchIn).sort((a,b)=> (b.punchIn||'').localeCompare(a.punchIn||''));
        const slice = all.slice(cursorPunchInISO ? all.findIndex(r=> r.punchIn === cursorPunchInISO)+1 : 0, pageSize);
        const next = slice.length === pageSize ? slice[slice.length-1].punchIn : null;
        return { items: slice, nextCursor: next };
      } catch {
        return { items: [] };
      }
    }
  }

  /** Live (unpaginated) watch of latest N user punches (default 100). */
  watchAllUserPunches(limitCount = 100): Observable<(PunchRecord & { id:string; durationMs:number })[]> {
    const user = this.auth.currentUser;
    if (!user) return new Observable(sub => { sub.next([]); sub.complete(); });
    return runInInjectionContext(this.injector, () => {
      const colRef = collection(this.firestore, 'punches');
      const qRef = query(colRef, where('userId','==', user.uid), orderBy('punchIn','desc'), limit(limitCount));
      return collectionData(qRef, { idField: 'id' }).pipe(
        map((rows: any[]) => rows.map(r => ({
          ...(r as PunchRecord),
          id: (r as any).id,
          durationMs: (() => {
            const start = this.getTimeMs(r.punchIn);
            const end = this.getTimeMs(r.punchOut);
            if (start && end) return end - start;
            return 0;
          })()
        })))
      );
    });
  }

  /** Fetch punch sessions for a given month (UTC month boundaries). Supports Timestamp & legacy ISO strings. */
  async getMonthSessions(year: number, monthIndex: number): Promise<(PunchRecord & { id:string; durationMs:number })[]> {
    const user = this.auth.currentUser; if (!user) return [];
    const startDate = new Date(Date.UTC(year, monthIndex, 1, 0,0,0,0));
    const endDate = new Date(Date.UTC(year, monthIndex+1, 1, 0,0,0,0));
    const startMs = startDate.getTime();
    const endMs = endDate.getTime();
    const results: (PunchRecord & { id:string; durationMs:number })[] = [];
    try {
      // Primary query assuming punchIn stored as Firestore Timestamp (compare using Date objects)
      const colRef = collection(this.firestore, 'punches');
      const qRef = query(
        colRef,
        where('userId','==', user.uid),
        where('punchIn','>=', startDate),
        where('punchIn','<', endDate),
        orderBy('punchIn','asc')
      );
      const snap = await getDocs(qRef);
      snap.forEach(d => {
        const data: any = d.data();
        const s = this.getTimeMs(data.punchIn);
        const e = this.getTimeMs(data.punchOut);
        const duration = (s && e) ? Math.max(0, e - s) : 0;
        results.push({ ...(data as PunchRecord), id: d.id, durationMs: duration });
      });
    } catch (err) {
      // Ignore – will rely on broad fallback below
    }
    // If no results (likely legacy ISO string punchIn docs), broad fallback + filter
    if (results.length === 0) {
      try {
        const colRef = collection(this.firestore, 'punches');
        const broad = await getDocs(query(colRef, where('userId','==', user.uid), limit(2000)));
        broad.forEach(d => {
          const data: any = d.data();
          const pinMs = this.getTimeMs(data.punchIn);
          if (!pinMs) return;
          if (pinMs < startMs || pinMs >= endMs) return;
            const poutMs = this.getTimeMs(data.punchOut);
            const duration = (pinMs && poutMs) ? Math.max(0, poutMs - pinMs) : 0;
            results.push({ ...(data as PunchRecord), id: d.id, durationMs: duration });
        });
      } catch { /* swallow */ }
    }
    // Final sort ascending by punchIn
    results.sort((a,b)=> (this.getTimeMs(a.punchIn)||0) - (this.getTimeMs(b.punchIn)||0));
    return results;
  }

  /** Quick scan to see if legacy embedded base64 image fields still exist for this user. */
  async hasLegacyEmbeddedImages(sampleLimit = 25): Promise<boolean> {
    const user = this.auth.currentUser; if (!user) return false;
    const colRef = collection(this.firestore, 'punches');
    const snap = await getDocs(query(colRef, where('userId','==', user.uid), orderBy('punchIn','desc'), limit(sampleLimit)));
    let legacy = false;
    snap.forEach(d => {
      if (legacy) return;
      const data: any = d.data();
      if (data.punchInPhotoDataUrl || data.punchOutPhotoDataUrl) legacy = true;
      if (Array.isArray(data.checkpoints)) {
        if (data.checkpoints.some((c:any) => c.photoDataUrl)) legacy = true;
      }
    });
    return legacy;
  }

  /** Migrates legacy embedded base64 image fields to Storage for current user. */
  async migrateLegacyImagesForCurrentUser(batchLimit = 40): Promise<{ processed:number; updated:number; uploads:number; errors:number }> {
    const user = this.auth.currentUser; if (!user) return { processed:0, updated:0, uploads:0, errors:0 };
    const colRef = collection(this.firestore, 'punches');
    const snap = await getDocs(query(colRef, where('userId','==', user.uid), orderBy('punchIn','desc'), limit(batchLimit)));
    let processed=0, updated=0, uploads=0, errors=0;
    for (const d of snap.docs) {
      processed++;
      const data: any = d.data();
      let changed = false;
      const updatePayload: any = { updatedAt: serverTimestamp() };
      // punchIn image
      if (data.punchInPhotoDataUrl && !data.punchInPhotoPath) {
        try {
          const up = await this.uploadDataUrl(`punches/${user.uid}/${d.id}_migr_in.jpg`, data.punchInPhotoDataUrl);
          updatePayload.punchInPhotoPath = up.path;
          if (up.url) updatePayload.punchInPhotoUrl = up.url;
          updatePayload.punchInPhotoDataUrl = deleteField();
          changed = true; uploads++;
        } catch { errors++; }
      }
      // punchOut image
      if (data.punchOutPhotoDataUrl && !data.punchOutPhotoPath) {
        try {
          const up = await this.uploadDataUrl(`punches/${user.uid}/${d.id}_migr_out.jpg`, data.punchOutPhotoDataUrl);
          updatePayload.punchOutPhotoPath = up.path;
            if (up.url) updatePayload.punchOutPhotoUrl = up.url;
          updatePayload.punchOutPhotoDataUrl = deleteField();
          changed = true; uploads++;
        } catch { errors++; }
      }
      // checkpoints
      if (Array.isArray(data.checkpoints)) {
        let cpChanged = false;
        const newCps = data.checkpoints.map((c:any, idx:number) => {
          if (c.photoDataUrl && !c.photoPath) {
            cpChanged = true;
            return { ...c, _legacyIndex: idx };
          }
          return c;
        });
        if (cpChanged) {
          for (let i=0;i<newCps.length;i++) {
            const cp = newCps[i];
            if (cp.photoDataUrl && !cp.photoPath) {
              try {
                const up = await this.uploadDataUrl(`punches/${user.uid}/${d.id}/checkpoints/${i}_migr_cp.jpg`, cp.photoDataUrl);
                cp.photoPath = up.path; if (up.url) cp.photoUrl = up.url; delete cp.photoDataUrl; uploads++;
              } catch { errors++; }
            }
          }
          updatePayload.checkpoints = newCps;
          changed = true;
        }
      }
      if (changed) {
        try { await updateDoc(doc(this.firestore, 'punches', d.id), updatePayload); updated++; } catch { errors++; }
      }
    }
    return { processed, updated, uploads, errors };
  }
}
