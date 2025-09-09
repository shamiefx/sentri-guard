import { Injectable, inject } from '@angular/core';
import { Auth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, UserCredential } from '@angular/fire/auth';
import { Firestore, collection, doc, serverTimestamp, setDoc, query, where, getDocs, limit } from '@angular/fire/firestore';

export interface RegisterPayload {
  staffId: string;
  email: string;
  password: string;
  companyCode: string;
}

export interface AppUserProfile {
  staffId: string;
  email: string;
  companyCode: string;
  createdAt: any; // Firestore timestamp
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private auth = inject<Auth>(Auth as any);
  private firestore = inject(Firestore);

  /**
   * Registers a new user using email/password and stores extended profile data in Firestore.
   * Enforces unique staffId.
   */
  async register(payload: RegisterPayload): Promise<UserCredential> {
    const { staffId, email, password, companyCode } = payload;

    // Enforce unique staffId
    const staffQuery = query(
      collection(this.firestore, 'users'),
      where('staffId', '==', staffId),
      limit(1)
    );
    const existing = await getDocs(staffQuery);
    if (!existing.empty) {
      throw new Error('Staff ID already in use');
    }

    const cred = await createUserWithEmailAndPassword(this.auth, email, password);
    const userDoc = doc(this.firestore, 'users', cred.user.uid);
    const profile: AppUserProfile = {
      staffId,
      email,
      companyCode,
      createdAt: serverTimestamp(),
    };
    await setDoc(userDoc, profile);
    return cred;
  }

  /**
   * Signs a user in with email & password.
   */
  async login(email: string, password: string): Promise<UserCredential> {
    return await signInWithEmailAndPassword(this.auth, email, password);
  }

  /**
   * Signs the current user out.
   */
  async logout(): Promise<void> {
    await signOut(this.auth);
  }
}
