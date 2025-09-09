import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { IonContent, IonInput, IonButton, IonNote, IonSpinner, IonIcon, IonToast, IonLabel } from '@ionic/angular/standalone';
import { AuthService } from '../services/auth.service';
import { Router } from '@angular/router';

@Component({
  standalone: true,
  selector: 'app-reset',
  templateUrl: './reset.page.html',
  styleUrls: ['./reset.page.scss'],
  imports: [IonLabel, CommonModule, ReactiveFormsModule, IonContent, IonInput, IonButton, IonNote, IonSpinner, IonIcon, IonToast]
})
export class ResetPage {
  private fb = inject(FormBuilder);
  private auth = inject(AuthService);
  private router = inject(Router);

  loading = signal(false);
  sent = signal(false);
  toastOpen = signal(false);
  toastMsg = signal('');

  form = this.fb.group({
    email: ['', [Validators.required, Validators.email]]
  });

  get f() { return this.form.controls; }

  async submit() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.loading.set(true);
    this.toastOpen.set(false);
    try {
      const { email } = this.form.value as { email: string };
      await this.auth.resetPassword(email);
      this.sent.set(true);
      this.toastMsg.set('If an account exists, a reset link was sent.');
      this.toastOpen.set(true);
    } catch (e: any) {
      const msg = e?.message || 'Failed to send reset email';
      this.toastMsg.set(msg);
      this.toastOpen.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  backToLogin() { this.router.navigateByUrl('/login'); }
}
