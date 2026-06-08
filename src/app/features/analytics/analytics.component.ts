import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { NgIf, NgFor, DecimalPipe, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AnalyticsService, AnalyticsData, DynamicReportResponse } from '../../core/services/analytics.service';

interface ChartItem {
  name: string;
  time: number;
  percentage: number;
}

@Component({
  selector: 'app-analytics',
  standalone: true,
  imports: [NgIf, NgFor, DecimalPipe, DatePipe, FormsModule],
  templateUrl: './analytics.component.html',
  styleUrl: './analytics.component.scss'
})
export class AnalyticsComponent implements OnInit {
  private analyticsSvc = inject(AnalyticsService);

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
}
