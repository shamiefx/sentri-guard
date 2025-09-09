import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { IonContent, IonInput, IonButton, IonNote, IonSpinner, IonIcon } from '@ionic/angular/standalone';
import { AuthService } from '../services/auth.service';
import { CompanyService } from '../services/company.service';

@Component({
  standalone: true,
  selector: 'app-register',
  templateUrl: './register.page.html',
  styleUrls: ['./register.page.scss'],
  imports: [CommonModule, ReactiveFormsModule, IonContent, IonInput, IonButton, IonNote, IonSpinner, IonIcon]
})
export class RegisterPage {
  private fb = inject(FormBuilder);
  private auth = inject(AuthService);
  private companyService = inject(CompanyService);
  private router = inject(Router);

  loading = signal(false);
  error = signal<string | null>(null);
  showPwd = false;

  form = this.fb.group({
  name: ['', [Validators.required, Validators.minLength(2)]],
    staffId: ['', [Validators.required, Validators.minLength(2)]],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]],
    companyCode: ['', [Validators.required, Validators.minLength(2)]],
  });

  get f() { return this.form.controls; }

  async submit() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    try {
      const code = this.form.value.companyCode as string;
      const company = await this.companyService.getCompanyByCode(code);
      if (!company) {
        throw new Error('Invalid company code');
      }
  await this.auth.register({ ...(this.form.value as any), companyCode: company.companyCode });
      this.router.navigateByUrl('/tabs');
    } catch (e: any) {
      this.error.set(e.message || 'Registration failed');
    } finally {
      this.loading.set(false);
    }
  }

  togglePwd(){ this.showPwd = !this.showPwd; }
}
