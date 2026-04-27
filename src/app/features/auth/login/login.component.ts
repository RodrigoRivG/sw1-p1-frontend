import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { NgIf } from '@angular/common';
import { AuthService } from '../../../core/services/auth.service';
import { LoginCredentials } from '../../../core/models';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule, NgIf],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss'
})
export class LoginComponent {
  private authService = inject(AuthService);
  private router = inject(Router);

  credentials: LoginCredentials = { email: '', password: '' };
  loading = signal(false);
  error = signal<string | null>(null);

  onSubmit(): void {
    if (!this.credentials.email || !this.credentials.password) return;

    this.loading.set(true);
    this.error.set(null);

    this.authService.login(this.credentials).subscribe({
      next: (res) => {
        const role = res.role;
        this.router.navigate(role === 'admin' ? ['/admin/policies'] : ['/monitor']);
      },
      error: () => {
        this.error.set('Credenciales incorrectas. Verificá usuario y contraseña.');
        this.loading.set(false);
      }
    });
  }
}
