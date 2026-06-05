import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { DbDocument, DocumentVersion, DocumentPermission, PermissionLevel } from '../models';

@Injectable({ providedIn: 'root' })
export class DocumentService {
  private http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/documents`;

  // GET /api/documents/policy/{policyId}
  getDocumentsByPolicy(policyId: string): Observable<DbDocument[]> {
    return this.http.get<DbDocument[]>(`${this.apiUrl}/policy/${policyId}`);
  }

  // GET /api/documents/{id}
  getDocumentById(id: string): Observable<DbDocument> {
    return this.http.get<DbDocument>(`${this.apiUrl}/${id}`);
  }

  // POST /api/documents
  createDocument(policyId: string, name: string, file: File): Observable<DbDocument> {
    const formData = new FormData();
    const type = file.name.split('.').pop()?.toLowerCase() || '';
    const requestData = {
      policyId,
      name,
      type
    };
    formData.append('request', new Blob([JSON.stringify(requestData)], { type: 'application/json' }));
    formData.append('file', file);
    return this.http.post<DbDocument>(this.apiUrl, formData);
  }

  // PUT /api/documents/{id}
  updateDocument(id: string, file: File, changeDescription: string): Observable<DbDocument> {
    const formData = new FormData();
    const requestData = {
      changeDescription
    };
    formData.append('request', new Blob([JSON.stringify(requestData)], { type: 'application/json' }));
    formData.append('file', file);
    return this.http.put<DbDocument>(`${this.apiUrl}/${id}`, formData);
  }

  // GET /api/documents/{id}/history
  getVersionHistory(id: string): Observable<DocumentVersion[]> {
    return this.http.get<DocumentVersion[]>(`${this.apiUrl}/${id}/history`);
  }

  // POST /api/documents/{id}/restore/{versionNumber}
  restoreVersion(id: string, versionNumber: number): Observable<DbDocument> {
    return this.http.post<DbDocument>(`${this.apiUrl}/${id}/restore/${versionNumber}`, {});
  }

  // GET /api/documents/{id}/permissions
  getDocumentPermissions(id: string): Observable<DocumentPermission[]> {
    return this.http.get<DocumentPermission[]>(`${this.apiUrl}/${id}/permissions`);
  }

  // PUT /api/documents/{documentId}/permissions/{nodeId}
  updatePermission(documentId: string, nodeId: string, permissionLevel: PermissionLevel): Observable<DocumentPermission> {
    return this.http.put<DocumentPermission>(
      `${this.apiUrl}/${documentId}/permissions/${nodeId}`,
      { permissionLevel }
    );
  }

  // GET /api/documents/{documentId}/check-permission
  checkPermission(documentId: string, nodeId: string): Observable<{ permissionLevel: PermissionLevel }> {
    const params = new HttpParams().set('nodeId', nodeId);
    return this.http.get<{ permissionLevel: PermissionLevel }>(
      `${this.apiUrl}/${documentId}/check-permission`,
      { params }
    );
  }

  // DELETE /api/documents/{id}
  // Aunque no figura explícitamente en el listado de endpoints en el prompt,
  // el usuario mencionó "listar, subir y eliminar documentos" en el repositorio.
  // Proporcionamos este método mapeado a DELETE /api/documents/{id} de forma lógica.
  deleteDocument(id: string): Observable<any> {
    return this.http.delete<any>(`${this.apiUrl}/${id}`);
  }
}
