import { Injectable, inject } from '@angular/core';
import { Firestore, doc, getDoc, collection, query, where, limit, getDocs } from '@angular/fire/firestore';

export interface Company {
  id: string;
  companyCode: string;
  name?: string;
  [key: string]: any;
}

@Injectable({ providedIn: 'root' })
export class CompanyService {
  private firestore = inject(Firestore);

  /**
   * Validates and resolves a company by code. Tries doc id first, then field query.
   * Returns the company data or null if not found.
   */
  async getCompanyByCode(code: string): Promise<Company | null> {
    const trimmed = (code || '').trim();
    if (!trimmed) return null;

    // Try direct doc (companies/{code})
    const directRef = doc(this.firestore, 'companies', trimmed);
    const snap = await getDoc(directRef);
    if (snap.exists()) {
      const data = snap.data() as any;
      return { id: snap.id, companyCode: data.companyCode || snap.id, ...data };
    }

    // Fallback: query where companyCode field matches
    const colRef = collection(this.firestore, 'companies');
    const q = query(colRef, where('companyCode', '==', trimmed), limit(1));
    const qSnap = await getDocs(q);
    if (!qSnap.empty) {
      const d = qSnap.docs[0];
      const data = d.data() as any;
      return { id: d.id, companyCode: data.companyCode || d.id, ...data };
    }
    return null;
  }
}
