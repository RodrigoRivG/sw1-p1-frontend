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

export interface ReportFilter {
  startDate: string | null;
  endDate: string | null;
  department: string | null;
  type: string | null;
  client?: string | null;
}

export interface ReportProcedure {
  id?: string;
  policyId?: string;
  clientName: string;
  status: string;
  createdAt: string;
  policyName?: string;
  totalMinutes?: number | string;
}

export interface DynamicReportData {
  procedures: ReportProcedure[];
  totalProcedures: number;
  period: {
    from: string;
    to: string;
  };
  department: string;
}

export interface DynamicReportResponse {
  filters: ReportFilter;
  report: DynamicReportData;
}

@Injectable({ providedIn: 'root' })
export class AnalyticsService {
  private http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/analytics`;

  getAnalytics(): Observable<AnalyticsData> {
    return this.http.get<AnalyticsData>(this.apiUrl);
  }

  getDynamicReport(query: string): Observable<DynamicReportResponse> {
    return this.http.post<DynamicReportResponse>(`${this.apiUrl}/report`, { query });
  }
}
