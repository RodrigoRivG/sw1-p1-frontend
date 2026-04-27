import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { Policy, PolicyRequest } from '../models';

@Injectable({ providedIn: 'root' })
export class PolicyService {
  private http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/policies`;

  // GET /api/policies — todas las políticas
  getAll(): Observable<Policy[]> {
    return this.http.get<Policy[]>(this.apiUrl);
  }

  // GET /api/policies/{id}
  getById(id: string): Observable<Policy> {
    return this.http.get<Policy>(`${this.apiUrl}/${id}`);
  }

  // GET /api/policies/my-policies — políticas del usuario autenticado
  getMyPolicies(): Observable<Policy[]> {
    return this.http.get<Policy[]>(`${this.apiUrl}/my-policies`);
  }

  // GET /api/policies/as-collaborator — políticas donde es colaborador
  getAsCollaborator(): Observable<Policy[]> {
    return this.http.get<Policy[]>(`${this.apiUrl}/as-collaborator`);
  }

  // POST /api/policies
  create(request: PolicyRequest): Observable<Policy> {
    return this.http.post<Policy>(this.apiUrl, request);
  }

  // PUT /api/policies/{id}
  update(id: string, request: PolicyRequest): Observable<Policy> {
    return this.http.put<Policy>(`${this.apiUrl}/${id}`, request);
  }

  // DELETE /api/policies/{id}
  delete(id: string): Observable<string> {
    return this.http.delete<string>(`${this.apiUrl}/${id}`, { responseType: 'text' as 'json' });
  }

  // POST /api/policies/{id}/collaborators
  addCollaborator(id: string, userId: string): Observable<Policy> {
    return this.http.post<Policy>(`${this.apiUrl}/${id}/collaborators`, { userId });
  }

  // DELETE /api/policies/{id}/collaborators/{userId}
  removeCollaborator(id: string, userId: string): Observable<Policy> {
    return this.http.delete<Policy>(`${this.apiUrl}/${id}/collaborators/${userId}`);
  }
}
