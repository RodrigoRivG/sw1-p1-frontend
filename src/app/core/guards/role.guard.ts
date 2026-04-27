import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { UserRole } from '../models';

export const roleGuard = (requiredRole: UserRole): CanActivateFn => {
  return () => {
    const authService = inject(AuthService);
    const router = inject(Router);

    if (authService.hasRole(requiredRole)) {
      return true;
    }

    // Redirect to appropriate default route based on actual role
    const userRole = authService.currentUser()?.role;
    if (userRole === 'admin') {
      return router.createUrlTree(['/admin/policies']);
    }
    if (userRole === 'employee') {
      return router.createUrlTree(['/monitor']);
    }

    return router.createUrlTree(['/login']);
  };
};
