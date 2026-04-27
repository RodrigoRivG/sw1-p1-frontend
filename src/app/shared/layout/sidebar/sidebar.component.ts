import { Component, Input } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { NgIf, NgFor } from '@angular/common';
import { UserRole } from '../../../core/models';

interface NavItem {
  label: string;
  icon: string;
  route: string;
  roles: UserRole[];
}

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, NgIf, NgFor],
  templateUrl: './sidebar.component.html',
  styleUrl: './sidebar.component.scss'
})
export class SidebarComponent {
  @Input() collapsed = false;
  @Input() role: UserRole = 'employee';

  navItems: NavItem[] = [
    { label: 'Políticas',  icon: '📋', route: '/admin/policies', roles: ['admin'] },
    { label: 'Diseñador',  icon: '🎨', route: '/admin/designer', roles: ['admin'] },
    { label: 'Monitor',    icon: '📊', route: '/monitor',         roles: ['employee'] },
  ];

  get visibleItems(): NavItem[] {
    return this.navItems.filter(item => item.roles.includes(this.role));
  }
}
