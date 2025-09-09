import { Injectable, inject } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import { Firestore, addDoc, collection, doc, serverTimestamp, updateDoc, getDoc, query, where, limit, getDocs, orderBy, collectionData } from '@angular/fire/firestore';
import { Observable, map } from 'rxjs';
import { Geolocation } from '@capacitor/geolocation';
import { Camera, CameraResultType, CameraSource, CameraDirection } from '@capacitor/camera';

export interface PunchRecord {
  userId: string;
  companyCode?: string;
  staffId?: string;
  email?: string;
  punchIn?: string; // ISO timestamp
  punchInLocation?: { lat: number; lng: number; accuracy?: number };
  punchInPhotoDataUrl?: string; // base64 / data URL (lightweight; consider storage for prod)
  punchOut?: string | null; // null while session open
  punchOutLocation?: { lat: number; lng: number; accuracy?: number };
  punchOutPhotoDataUrl?: string;
  createdAt?: any;
  updatedAt?: any;
}

@Injectable({ providedIn: 'root' })
export class PunchService {
  private firestore = inject(Firestore);
  private auth = inject<Auth>(Auth as any);

  async captureLocation(): Promise<{ lat: number; lng: number; accuracy?: number }> {
    const position = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 15000 });
    return { lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy };
  }

  async capturePhotoFrontAndResize(): Promise<string> {
    // Open front camera first (no location yet to minimize delay before user action)
    const photo = await Camera.getPhoto({
      resultType: CameraResultType.DataUrl,
      source: CameraSource.Camera,
      direction: CameraDirection.Front,
      quality: 55,
      width: 480,
      height: 480,
      allowEditing: false,
    });
    const dataUrl = photo.dataUrl || '';
    // Additional client-side downscale to ~256px max dimension for Firestore size efficiency
    try {
      const resized = await this.downscaleDataUrl(dataUrl, 256);
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

  /** Returns the open punch record id (if any) for the current user. */
  async getOpenPunchId(): Promise<string | null> {
    const user = this.auth.currentUser;
    if (!user) return null;
    const colRef = collection(this.firestore, 'punches');
    const qRef = query(colRef, where('userId', '==', user.uid), where('punchOut', '==', null), limit(1));
    const snap = await getDocs(qRef);
    if (snap.empty) return null;
    return snap.docs[0].id;
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
      punchIn: new Date().toISOString(),
      punchInLocation: location,
      punchInPhotoDataUrl: photoDataUrl,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      punchOut: null,
      ...(finalCompanyCode ? { companyCode: finalCompanyCode } : {})
      , ...(staffId ? { staffId } : {})
      , ...(email ? { email } : {})
    };
    const colRef = collection(this.firestore, 'punches');
    const docRef = await addDoc(colRef, punch as any);
    return docRef.id;
  }

  /** Punch out: updates latest open record (no punchOut). */
  async punchOut(recordId: string) {
  const user = this.auth.currentUser;
    if (!user) throw new Error('Not authenticated');
    const photoDataUrl = await this.capturePhotoFrontAndResize();
    const location = await this.captureLocation();
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
      punchOut: new Date().toISOString(),
      punchOutLocation: location,
      punchOutPhotoDataUrl: photoDataUrl,
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
    const colRef = collection(this.firestore, 'punches');
    const qRef = query(colRef, where('userId','==', user.uid), orderBy('punchIn','desc'), limit(20));
    return collectionData(qRef, { idField: 'id' }).pipe(
      map((rows: any[]) => rows.map((r: any) => ({
        ...(r as PunchRecord),
        id: r.id,
        durationMs: (r.punchOut && r.punchIn) ? (new Date(r.punchOut).getTime() - new Date(r.punchIn).getTime()) : 0
      })))
    );
  }

  /** Compute today's total worked milliseconds (completed punches only). */
  async getTodayTotalMs(): Promise<number> {
    const user = this.auth.currentUser; if (!user) return 0;
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(start.getTime() + 86400000);
    const startISO = start.toISOString();
    const endISO = end.toISOString();
    // Try ranged query; may require index. Fallback if fails.
    try {
      const colRef = collection(this.firestore, 'punches');
      const qRef = query(colRef, where('userId','==', user.uid), where('punchIn','>=', startISO), where('punchIn','<', endISO));
      const snap = await getDocs(qRef);
      let total = 0;
      snap.forEach(d => {
        const data: any = d.data();
        if (data.punchIn && data.punchOut) {
          total += (new Date(data.punchOut).getTime() - new Date(data.punchIn).getTime());
        }
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
    const startISO = start.toISOString();
    const endISO = end.toISOString();
    try {
      const colRef = collection(this.firestore, 'punches');
      const qRef = query(colRef, where('userId','==', user.uid), where('punchIn','>=', startISO), where('punchIn','<', endISO), orderBy('punchIn','asc'));
      const snap = await getDocs(qRef);
      const sessions: (PunchRecord & {id:string; durationMs:number})[] = [];
      snap.forEach(d => {
        const data: any = d.data();
        const duration = (data.punchIn && data.punchOut) ? (new Date(data.punchOut).getTime() - new Date(data.punchIn).getTime()) : (data.punchIn ? (Date.now() - new Date(data.punchIn).getTime()) : 0);
        sessions.push({ ...(data as PunchRecord), id: d.id, durationMs: duration });
      });
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
    const startISO = start.toISOString();
    const endISO = end.toISOString();
    const colRef = collection(this.firestore, 'punches');
    const qRef = query(colRef,
      where('userId','==', user.uid),
      where('punchIn','>=', startISO),
      where('punchIn','<', endISO),
      orderBy('punchIn','asc')
    );
    return collectionData(qRef, { idField: 'id' }).pipe(
      map((rows: any[]) => rows.map(r => ({
        ...(r as PunchRecord),
        id: (r as any).id,
        durationMs: (r.punchIn && r.punchOut)
          ? (new Date(r.punchOut).getTime() - new Date(r.punchIn).getTime())
          : (r.punchIn ? (Date.now() - new Date(r.punchIn).getTime()) : 0)
      })))
    );
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
    const startISO = start.toISOString();
    const endISO = end.toISOString();
    try {
      const colRef = collection(this.firestore, 'punches');
      const qRef = query(colRef,
        where('companyCode','==', companyCode),
        where('punchIn','>=', startISO),
        where('punchIn','<', endISO),
        orderBy('punchIn','asc')
      );
      const snap = await getDocs(qRef);
      const list: (PunchRecord & { id:string; durationMs:number; active:boolean })[] = [];
      snap.forEach(d => {
        const data: any = d.data();
        const active = !data.punchOut;
        const duration = (data.punchIn && data.punchOut) ? (new Date(data.punchOut).getTime() - new Date(data.punchIn).getTime()) : (data.punchIn ? (Date.now() - new Date(data.punchIn).getTime()) : 0);
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
          if (data.punchIn < startISO || data.punchIn >= endISO) return; // filter to today
          const active = !data.punchOut;
            const duration = (data.punchIn && data.punchOut) ? (new Date(data.punchOut).getTime() - new Date(data.punchIn).getTime()) : (Date.now() - new Date(data.punchIn).getTime());
          within.push({ ...(data as PunchRecord), id: d.id, durationMs: duration, active });
        });
        within.sort((a,b)=> (a.punchIn||'').localeCompare(b.punchIn||''));
        return within;
      } catch {
        return [];
      }
    }
  }
}
