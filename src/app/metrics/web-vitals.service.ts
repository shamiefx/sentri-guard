import { Injectable } from '@angular/core';
import { onLCP, onCLS, onINP, Metric } from 'web-vitals';

@Injectable({ providedIn: 'root' })
export class WebVitalsService {
  private send(m: Metric) {
    try {
      const payload = JSON.stringify({ name: m.name, value: m.value, id: m.id, rating: m.rating, ts: Date.now() });
      navigator.sendBeacon?.('/analytics', payload);
      // Fallback: console log (can be replaced with Firestore/HTTP later)
      if (!navigator.sendBeacon) console.debug('[web-vitals]', payload);
    } catch (e) {
      console.warn('[web-vitals] send failed', e);
    }
  }
  start() {
    onLCP(this.send.bind(this));
    onCLS(this.send.bind(this));
    onINP(this.send.bind(this));
  }
}
