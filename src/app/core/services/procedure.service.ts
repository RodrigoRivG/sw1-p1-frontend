import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { Procedure } from '../models';

@Injectable({ providedIn: 'root' })
export class ProcedureService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/procedures`;

  // GET /api/procedures/{id}
  getById(id: string): Observable<Procedure> {
    return this.http.get<Procedure>(`${this.apiUrl}/${id}`);
  }

  // POST /api/procedures
  create(request: import('../models').ProcedureRequest): Observable<Procedure> {
    return this.http.post<Procedure>(this.apiUrl, request);
  }
}
