import { Component, EnvironmentInjector, inject } from '@angular/core';
import { IonTabs, IonTabBar, IonTabButton, IonIcon, IonLabel } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { triangle, ellipse, square, logOutOutline } from 'ionicons/icons';
import { AuthService } from '../services/auth.service';
import { Router } from '@angular/router';

@Component({
  selector: 'app-tabs',
  templateUrl: 'tabs.page.html',
  styleUrls: ['tabs.page.scss'],
  imports: [IonTabs, IonTabBar, IonTabButton, IonIcon, IonLabel],
})
export class TabsPage {
  public environmentInjector = inject(EnvironmentInjector);
  private auth = inject(AuthService);
  private router = inject(Router);

  constructor() {
    addIcons({ triangle, ellipse, square, 'log-out-outline': logOutOutline });
  }

  async logout() {
    try { await this.auth.logout(); } catch (_) {}
    this.router.navigateByUrl('/login');
  }
}
