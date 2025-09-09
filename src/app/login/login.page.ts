import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import {
  IonContent, IonInput, IonButton, IonNote, IonSpinner, IonIcon, IonToast
} from '@ionic/angular/standalone';
import { AuthService } from '../services/auth.service';

@Component({
  standalone: true,
  selector: 'app-login',
  templateUrl: './login.page.html',
  styleUrls: ['./login.page.scss'],
  imports: [
    CommonModule,
    ReactiveFormsModule,
    IonContent, IonInput, IonButton, IonNote, IonSpinner, IonIcon, IonToast
  ]
})
export class LoginPage {
  private fb = inject(FormBuilder);
  private auth = inject(AuthService);
  private router = inject(Router);

  loading = signal(false);
  toastOpen = signal(false);
  toastMsg  = signal('');
  showPwd = false;
  error = signal<string | null>(null);

  form = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]],
  });

  get f() { return this.form.controls; }

  async submit() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      // Small UX touch: focus the first invalid control
      const firstInvalid = document.querySelector<HTMLElement>('.field.is-invalid ion-input');
      firstInvalid?.focus();
      return;
    }

    this.loading.set(true);
    this.toastOpen.set(false);

    try {
      const { email, password } = this.form.value as { email: string; password: string };
      await this.auth.login(email, password);
      // Optional: small success toast (swap to 'success' color if you prefer)
      this.toastMsg.set('Welcome back!');
      this.toastOpen.set(true);
      this.router.navigateByUrl('/tabs');
    } catch (e: any) {
      console.error('Login failed', e);
      const message = e?.message || 'Login failed. Please try again.';
      this.error.set(message);
      this.toastMsg.set(message);
      this.toastOpen.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  goToRegister() {
    this.router.navigateByUrl('/register');
  }

  goToReset() {
    this.router.navigateByUrl('/reset');
  }

  togglePwd() { this.showPwd = !this.showPwd; }
}
