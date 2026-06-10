import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface DelayRiskRequest {
  num_nodes: number;
  num_parallel: number;
  avg_node_time: number;
  department_load: number;
}

export interface DelayRiskResponse {
  delay_risk: number;
  risk_level: 'bajo' | 'medio' | 'alto';
}

export interface AnomalyRequest {
  num_nodes: number;
  num_parallel: number;
  avg_node_time: number;
  department_load: number;
}

export interface AnomalyResponse {
  anomaly_score: number;
  is_anomaly: boolean;
  severity: 'normal' | 'media' | 'alta';
}

export interface BestRouteRequest {
  route_a_avg_time: number;
  route_b_avg_time: number;
  route_a_load: number;
  route_b_load: number;
  route_a_nodes: number;
  route_b_nodes: number;
}

export interface BestRouteResponse {
  best_route: 'A' | 'B';
  confidence: number;
  explanation: string;
}

@Injectable({ providedIn: 'root' })
export class PredictionService {
  private http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/predictions`;

  predictDelayRisk(request: DelayRiskRequest): Observable<DelayRiskResponse> {
    return this.http.post<DelayRiskResponse>(`${this.apiUrl}/delay-risk`, request);
  }

  predictAnomaly(request: AnomalyRequest): Observable<AnomalyResponse> {
    return this.http.post<AnomalyResponse>(`${this.apiUrl}/anomaly`, request);
  }

  predictBestRoute(request: BestRouteRequest): Observable<BestRouteResponse> {
    return this.http.post<BestRouteResponse>(`${this.apiUrl}/best-route`, request);
  }
}
