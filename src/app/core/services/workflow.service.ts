import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { WorkflowDefinition } from '../models';

@Injectable({ providedIn: 'root' })
export class WorkflowService {
  private http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/workflows`;

  getWorkflow(policyId: number): Observable<WorkflowDefinition> {
    return this.http.get<WorkflowDefinition>(`${this.apiUrl}/${policyId}`);
  }

  saveWorkflow(definition: WorkflowDefinition): Observable<WorkflowDefinition> {
    return this.http.put<WorkflowDefinition>(
      `${this.apiUrl}/${definition.policyId}`,
      definition
    );
  }

  publishWorkflow(policyId: number): Observable<void> {
    return this.http.post<void>(`${this.apiUrl}/${policyId}/publish`, {});
  }
}
