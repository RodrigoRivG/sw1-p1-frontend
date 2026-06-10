import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { NgIf, NgFor, DecimalPipe, DatePipe, UpperCasePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AnalyticsService, AnalyticsData, DynamicReportResponse } from '../../core/services/analytics.service';
import { PolicyService } from '../../core/services/policy.service';
import { PredictionService, AnomalyResponse } from '../../core/services/prediction.service';
import { Policy } from '../../core/models';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

interface ChartItem {
  name: string;
  time: number;
  percentage: number;
}

@Component({
  selector: 'app-analytics',
  standalone: true,
  imports: [NgIf, NgFor, DecimalPipe, DatePipe, UpperCasePipe, FormsModule],
  templateUrl: './analytics.component.html',
  styleUrl: './analytics.component.scss'
})
export class AnalyticsComponent implements OnInit {
  private analyticsSvc = inject(AnalyticsService);
  private policySvc = inject(PolicyService);
  private predictionSvc = inject(PredictionService);

  // Tab State
  activeTab = signal<'dashboard' | 'report'>('dashboard');

  // General Dashboard State
  data = signal<AnalyticsData | null>(null);
  loading = signal<boolean>(true);
  error = signal<string | null>(null);

  // Dynamic Report State
  queryText = signal<string>('');
  loadingReport = signal<boolean>(false);
  reportResult = signal<DynamicReportResponse | null>(null);
  reportError = signal<string | null>(null);
  isListeningVoice = signal<boolean>(false);

  // Policies Map & Anomaly detection
  policiesMap = new Map<string, Policy>();
  anomalyResults = signal<Record<string, AnomalyResponse>>({});
  analyzingAnomalies = signal<boolean>(false);
  private recognition: any = null;

  // Computed properties for charts (General Dashboard)
  nodesChart = computed<ChartItem[]>(() => {
    const analytics = this.data();
    if (!analytics || !analytics.avgTimeByNode) return [];

    const entries = Object.entries(analytics.avgTimeByNode);
    if (entries.length === 0) return [];

    const maxTime = Math.max(...entries.map(([_, time]) => time));

    return entries
      .map(([name, time]) => ({
        name,
        time,
        percentage: maxTime > 0 ? (time / maxTime) * 100 : 0
      }))
      .sort((a, b) => b.time - a.time);
  });

  usersChart = computed<ChartItem[]>(() => {
    const analytics = this.data();
    if (!analytics || !analytics.avgTimeByUser) return [];

    const entries = Object.entries(analytics.avgTimeByUser);
    if (entries.length === 0) return [];

    const maxTime = Math.max(...entries.map(([_, time]) => time));

    return entries
      .map(([name, time]) => ({
        name,
        time,
        percentage: maxTime > 0 ? (time / maxTime) * 100 : 0
      }))
      .sort((a, b) => a.time - b.time);
  });

  ngOnInit(): void {
    this.loadAnalytics();
    this.initSpeechRecognition();
    this.loadPolicies();
  }

  setTab(tab: 'dashboard' | 'report'): void {
    this.activeTab.set(tab);
  }

  loadAnalytics(): void {
    this.loading.set(true);
    this.error.set(null);
    this.analyticsSvc.getAnalytics().subscribe({
      next: (res) => {
        this.data.set(res);
        this.loading.set(false);
      },
      error: (err) => {
        console.error('Error loading analytics:', err);
        this.error.set('No se pudieron cargar los datos de analíticas. Por favor, asegúrate de que el backend esté en funcionamiento.');
        this.loading.set(false);
      }
    });
  }

  private initSpeechRecognition(): void {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    this.recognition = new SR();
    this.recognition.lang = 'es-ES';
    this.recognition.interimResults = false;
    this.recognition.onresult = (e: any) => {
      const t = e.results[0][0].transcript;
      this.queryText.update(v => v ? v + ' ' + t : t);
    };
    this.recognition.onerror = () => this.isListeningVoice.set(false);
    this.recognition.onend = () => this.isListeningVoice.set(false);
  }

  toggleVoice(): void {
    if (!this.recognition) return;
    if (this.isListeningVoice()) {
      this.recognition.stop();
      this.isListeningVoice.set(false);
    } else {
      this.recognition.start();
      this.isListeningVoice.set(true);
    }
  }

  generateReport(): void {
    const q = this.queryText().trim();
    if (!q || this.loadingReport()) return;

    this.loadingReport.set(true);
    this.reportError.set(null);
    this.anomalyResults.set({}); // Clear previous anomaly results
    this.analyticsSvc.getDynamicReport(q).subscribe({
      next: (res) => {
        this.reportResult.set(res);
        this.loadingReport.set(false);
      },
      error: (err) => {
        console.error('Error generating dynamic report:', err);
        const errorMsg = typeof err.error === 'string'
          ? err.error
          : 'No se pudo generar el reporte. Por favor, asegúrate de que el backend esté en funcionamiento.';
        this.reportError.set(errorMsg);
        this.loadingReport.set(false);
      }
    });
  }

  loadPolicies(): void {
    this.policySvc.getAll().subscribe({
      next: (list) => {
        list.forEach(p => this.policiesMap.set(p.id, p));
      },
      error: (err) => console.error('Error loading policies for analytics:', err)
    });
  }

  detectAnomalies(): void {
    const result = this.reportResult();
    if (!result || !result.report || !result.report.procedures) return;

    const inProgress = result.report.procedures.filter(p => p.status === 'in_progress');
    if (inProgress.length === 0) {
      alert('No hay trámites en proceso para analizar.');
      return;
    }

    this.analyzingAnomalies.set(true);

    const requests = inProgress.map(proc => {
      const policyId = (proc as any).policyId;
      const policy = policyId ? this.policiesMap.get(policyId) : null;
      
      const nodes = (policy?.diagram?.['nodes'] as any[]) || [];
      const numNodes = nodes.filter(n => n.data?.type === 'task').length;
      const numParallel = nodes.filter(n => n.data?.type === 'fork').length;

      return this.predictionSvc.predictAnomaly({
        num_nodes: numNodes || 5,
        num_parallel: numParallel || 0,
        avg_node_time: 60,
        department_load: 0.5
      }).pipe(
        catchError(err => {
          console.error(`Error predicting anomaly for procedure ${proc.clientName}:`, err);
          return of({ anomaly_score: 0, is_anomaly: false, severity: 'normal' } as AnomalyResponse);
        })
      );
    });

    forkJoin(requests).subscribe({
      next: (responses) => {
        const resultsMap: Record<string, AnomalyResponse> = { ...this.anomalyResults() };
        inProgress.forEach((proc, idx) => {
          resultsMap[(proc as any).id] = responses[idx];
        });
        this.anomalyResults.set(resultsMap);
        this.analyzingAnomalies.set(false);
      },
      error: (err) => {
        console.error('Error in forkJoin for anomaly detection:', err);
        this.analyzingAnomalies.set(false);
      }
    });
  }

  getAnomalyResult(procId: string | undefined): AnomalyResponse | undefined {
    return procId ? this.anomalyResults()[procId] : undefined;
  }
}
