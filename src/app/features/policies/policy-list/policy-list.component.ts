import { Component, inject, signal, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { NgIf, NgFor, NgClass, DecimalPipe, UpperCasePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { PolicyService } from '../../../core/services/policy.service';
import { AuthService } from '../../../core/services/auth.service';
import { ProcedureService } from '../../../core/services/procedure.service';
import { PredictionService, DelayRiskResponse } from '../../../core/services/prediction.service';
import { Policy, PolicyStatus } from '../../../core/models';

@Component({
  selector: 'app-policy-list',
  standalone: true,
  imports: [NgIf, NgFor, NgClass, FormsModule, DecimalPipe, UpperCasePipe],
  templateUrl: './policy-list.component.html',
  styleUrl: './policy-list.component.scss'
})
export class PolicyListComponent implements OnInit {
  private policyService = inject(PolicyService);
  private router = inject(Router);
  private authService = inject(AuthService);
  private procedureService = inject(ProcedureService);
  private predictionService = inject(PredictionService);

  policies = signal<Policy[]>([]);
  filteredPolicies = signal<Policy[]>([]);
  loading = signal(true);
  error = signal<string | null>(null);
  searchQuery = signal('');
  deletingId = signal<string | null>(null);

  isAdmin = signal<boolean>(this.authService.hasRole('admin'));

  // Estado del modal de iniciar trámite
  showStartProcedureModal = signal<boolean>(false);
  selectedPolicyForProcedure = signal<string | null>(null);
  procedureForm = signal({
    clientName: '',
    clientEmail: '',
    clientDetails: ''
  });
  submittingProcedure = signal<boolean>(false);
  successMessage = signal<string | null>(null);

  // Deep Learning Signals
  delayRiskResult = signal<DelayRiskResponse | null>(null);
  loadingDelayRisk = signal<boolean>(false);

  readonly statusLabels: Record<PolicyStatus, string> = {
    DRAFT:    'Borrador',
    ACTIVE:   'Activa',
    INACTIVE: 'Inactiva',
    ARCHIVED: 'Archivada'
  };

  ngOnInit(): void {
    this.loadPolicies();
  }

  loadPolicies(): void {
    this.loading.set(true);
    this.error.set(null);

    forkJoin({
      myPolicies: this.policyService.getMyPolicies(),
      collabPolicies: this.policyService.getAsCollaborator()
    }).subscribe({
      next: ({ myPolicies, collabPolicies }) => {
        // Combinar ambas listas y eliminar duplicados por si acaso
        const all = [...myPolicies, ...collabPolicies];
        const uniquePolicies = Array.from(new Map(all.map(p => [p.id, p])).values());
        
        this.policies.set(uniquePolicies);
        this.applyFilter();
        this.loading.set(false);
      },
      error: () => {
        this.error.set('No se pudieron cargar las políticas.');
        this.loading.set(false);
      }
    });
  }

  onSearch(query: string): void {
    this.searchQuery.set(query);
    this.applyFilter();
  }

  private applyFilter(): void {
    const q = this.searchQuery().toLowerCase().trim();
    if (!q) {
      this.filteredPolicies.set(this.policies());
      return;
    }
    this.filteredPolicies.set(
      this.policies().filter(p =>
        p.name.toLowerCase().includes(q) ||
        p.description?.toLowerCase().includes(q)
      )
    );
  }

  openDesigner(id?: string): void {
    if (id) {
      this.router.navigate(['/admin/designer', id]);
    } else {
      this.router.navigate(['/admin/designer']);
    }
  }

  deletePolicy(policy: Policy, event: Event): void {
    event.stopPropagation();
    if (!confirm(`¿Eliminár "${policy.name}"?`)) return;

    this.deletingId.set(policy.id);
    this.policyService.delete(policy.id).subscribe({
      next: () => {
        this.policies.update(list => list.filter(p => p.id !== policy.id));
        this.applyFilter();
        this.deletingId.set(null);
      },
      error: () => this.deletingId.set(null)
    });
  }

  statusClass(status: string): string {
    return `badge badge--${status.toLowerCase()}`;
  }

  trackById(_: number, p: Policy): string {
    return p.id;
  }

  // --- Modal Logic ---

  openStartProcedureModal(policyId: string, event: Event): void {
    event.stopPropagation();
    if (!this.isAdmin()) return;
    this.selectedPolicyForProcedure.set(policyId);
    this.procedureForm.set({ clientName: '', clientEmail: '', clientDetails: '' });
    this.showStartProcedureModal.set(true);
    this.successMessage.set(null);

    // Deep Learning prediction for Delay Risk
    const policy = this.policies().find(p => p.id === policyId);
    if (policy && policy.diagram) {
      const nodes = (policy.diagram['nodes'] as any[]) || [];
      const numNodes = nodes.filter(n => n.data?.type === 'task').length;
      const numParallel = nodes.filter(n => n.data?.type === 'fork').length;

      this.delayRiskResult.set(null);
      this.loadingDelayRisk.set(true);
      this.predictionService.predictDelayRisk({
        num_nodes: numNodes,
        num_parallel: numParallel,
        avg_node_time: 60,
        department_load: 0.5
      }).subscribe({
        next: (res) => {
          this.delayRiskResult.set(res);
          this.loadingDelayRisk.set(false);
        },
        error: (err) => {
          console.error('Error predicting delay risk:', err);
          this.loadingDelayRisk.set(false);
        }
      });
    } else {
      this.delayRiskResult.set(null);
    }
  }

  closeStartProcedureModal(): void {
    this.showStartProcedureModal.set(false);
    this.selectedPolicyForProcedure.set(null);
    this.delayRiskResult.set(null);
    this.loadingDelayRisk.set(false);
  }

  updateForm(field: 'clientName' | 'clientEmail' | 'clientDetails', event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.procedureForm.update(form => ({ ...form, [field]: value }));
  }

  submitProcedure(): void {
    const policyId = this.selectedPolicyForProcedure();
    const form = this.procedureForm();

    if (!policyId || !form.clientName.trim() || !form.clientEmail.trim()) {
      return;
    }

    this.submittingProcedure.set(true);

    this.procedureService.create({
      policyId,
      clientName: form.clientName.trim(),
      clientEmail: form.clientEmail.trim(),
      clientInfo: {
        details: form.clientDetails.trim()
      }
    }).subscribe({
      next: () => {
        this.submittingProcedure.set(false);
        this.closeStartProcedureModal();
        this.successMessage.set('Trámite iniciado. La primera tarea fue asignada automáticamente al funcionario correspondiente.');
        setTimeout(() => this.successMessage.set(null), 5000);
      },
      error: () => {
        this.submittingProcedure.set(false);
        alert('Ocurrió un error al iniciar el trámite.');
      }
    });
  }
}
