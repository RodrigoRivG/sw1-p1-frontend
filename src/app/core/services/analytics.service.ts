import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface AnalyticsData {
  avgTimeByNode: Record<string, number>;
  avgTimeByUser: Record<string, number>;
  bottleneckNode: string;
  mostEfficientUser: string;
  totalProcedures: number;
  completedProcedures: number;
  inProgressProcedures: number;
  totalCompletedTasks: number;
}

@Injectable({ providedIn: 'root' })
export class AnalyticsService {
  private http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/analytics`;

  getAnalytics(): Observable<AnalyticsData> {
    return this.http.get<AnalyticsData>(this.apiUrl);
  }
}
