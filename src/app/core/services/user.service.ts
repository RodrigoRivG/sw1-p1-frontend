import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface BasicUser {
  id: string;
  email: string;
  name?: string;
  role?: string;
}

@Injectable({ providedIn: 'root' })
export class UserService {
  private http = inject(HttpClient);

  getByEmail(email: string): Observable<BasicUser> {
    const params = new HttpParams().set('email', email);
    return this.http.get<BasicUser>(
      `${environment.apiUrl}/users/by-email`,
      { params }
    );
  }
}
