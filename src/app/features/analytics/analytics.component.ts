import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { NgIf, NgFor, DecimalPipe } from '@angular/common';
import { AnalyticsService, AnalyticsData } from '../../core/services/analytics.service';

interface ChartItem {
  name: string;
  time: number;
  percentage: number;
}

@Component({
  selector: 'app-analytics',
  standalone: true,
  imports: [NgIf, NgFor, DecimalPipe],
  templateUrl: './analytics.component.html',
  styleUrl: './analytics.component.scss'
})
export class AnalyticsComponent implements OnInit {
  private analyticsSvc = inject(AnalyticsService);

  data = signal<AnalyticsData | null>(null);
  loading = signal<boolean>(true);
  error = signal<string | null>(null);

  // Computed properties for charts
  nodesChart = computed<ChartItem[]>(() => {
    const analytics = this.data();
    if (!analytics || !analytics.avgTimeByNode) return [];

    const entries = Object.entries(analytics.avgTimeByNode);
    if (entries.length === 0) return [];

    // Find the max time to calculate relative percentages for the CSS bars
    const maxTime = Math.max(...entries.map(([_, time]) => time));

    return entries
      .map(([name, time]) => ({
        name,
        time,
        percentage: maxTime > 0 ? (time / maxTime) * 100 : 0
      }))
      .sort((a, b) => b.time - a.time); // Slowest first
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
      .sort((a, b) => a.time - b.time); // Fastest first (Efficiency leaderboard!)
  });

  ngOnInit(): void {
    this.loadAnalytics();
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
}
