import { bootstrapApplication } from '@angular/platform-browser';
import { enableProdMode } from '@angular/core';
import { RouteReuseStrategy, provideRouter, withPreloading, PreloadAllModules } from '@angular/router';
import { IonicRouteStrategy, provideIonicAngular } from '@ionic/angular/standalone';
import { AppComponent } from './app/app.component';
import { routes } from './app/app.routes';
// Firebase imports (@angular/fire v20)
import { provideFirebaseApp, initializeApp } from '@angular/fire/app';
import { provideAuth, getAuth } from '@angular/fire/auth';
import { provideFirestore, getFirestore } from '@angular/fire/firestore';
import { provideStorage, getStorage } from '@angular/fire/storage';
import { environment } from './environments/environment';
// PWA Elements (e.g., pwa-camera-modal for web camera support)
import { defineCustomElements } from '@ionic/pwa-elements/loader'; // path is valid (contains loader/index.js)

// Enable Angular production mode if applicable.
if (environment.production) {
  enableProdMode();
}

// Build Firebase providers only if a (non-placeholder) apiKey looks set.
const hasFirebaseConfig = !!environment.firebase?.apiKey && !environment.firebase.apiKey.startsWith('DEV_') && !environment.firebase.apiKey.startsWith('PROD_API_KEY');
const firebaseProviders = hasFirebaseConfig
  ? [
      provideFirebaseApp(() => initializeApp(environment.firebase)),
      provideAuth(() => getAuth()),
      provideFirestore(() => getFirestore()),
      provideStorage(() => getStorage()),
    ]
  : [];

if (!hasFirebaseConfig) {
  // eslint-disable-next-line no-console
  console.warn('[startup] Firebase config appears to be placeholder; skipping Firebase initialization.');
}

bootstrapApplication(AppComponent, {
  providers: [
    { provide: RouteReuseStrategy, useClass: IonicRouteStrategy },
    provideIonicAngular(),
    provideRouter(routes, withPreloading(PreloadAllModules)),
    ...firebaseProviders,
  ]
}).catch(err => console.error(err));

// Register Ionic PWA custom elements (camera, etc.) after app bootstrap.
defineCustomElements(window);
