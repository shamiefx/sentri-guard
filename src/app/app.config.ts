import { ApplicationConfig, APP_INITIALIZER } from '@angular/core';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';
import { WebVitalsService } from './metrics/web-vitals.service';

function startVitals(w: WebVitalsService) { return () => w.start(); }

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),
    { provide: APP_INITIALIZER, multi: true, useFactory: startVitals, deps: [WebVitalsService] }
  ]
};
