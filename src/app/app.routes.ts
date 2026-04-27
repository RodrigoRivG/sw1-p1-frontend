import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { roleGuard } from './core/guards/role.guard';
import { ShellComponent } from './shared/layout/shell/shell.component';
import { LoginComponent } from './features/auth/login/login.component';
import { PolicyListComponent } from './features/policies/policy-list/policy-list.component';
import { DesignerComponent } from './features/designer/designer.component';
import { MonitorComponent } from './features/monitor/monitor.component';

export const routes: Routes = [
  { path: '', redirectTo: 'login', pathMatch: 'full' },
  { path: 'login', component: LoginComponent },

  {
    path: 'admin',
    component: ShellComponent,
    canActivate: [authGuard, roleGuard('admin')],
    children: [
      { path: '', redirectTo: 'policies', pathMatch: 'full' },
      { path: 'policies', component: PolicyListComponent },
      { path: 'designer', component: DesignerComponent },
      { path: 'designer/:id', component: DesignerComponent },
    ]
  },

  {
    path: 'monitor',
    component: ShellComponent,
    canActivate: [authGuard, roleGuard('employee')],
    children: [
      { path: '', component: MonitorComponent }
    ]
  },

  { path: '**', redirectTo: 'login' }
];
