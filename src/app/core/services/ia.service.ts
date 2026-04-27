import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface IaReportRequest {
  taskLabel: string;
  description: string;
}

export interface IaReportResponse {
  report: string;
}

export interface IaDesignerRequest {
  diagram: any;
  instruction: string;
}

@Injectable({
  providedIn: 'root'
})
export class IaService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/ia`;

  generateReport(request: IaReportRequest): Observable<IaReportResponse> {
    return this.http.post<IaReportResponse>(`${this.apiUrl}/generate-report`, request);
  }

  designFlow(request: IaDesignerRequest): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/design-flow`, request);
  }

  designerAgent(question: string): Observable<{ response: string }> {
    return this.http.post<{ response: string }>(`${this.apiUrl}/designer-agent`, { question });
  }
}
