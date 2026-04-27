import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { Task, TaskCompleteRequest } from '../models';

@Injectable({ providedIn: 'root' })
export class TaskService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/tasks`;

  // GET /api/tasks/my-tasks
  getMyTasks(): Observable<Task[]> {
    return this.http.get<Task[]>(`${this.apiUrl}/my-tasks`);
  }

  // PUT /api/tasks/{id}/completed
  completeTask(id: string, request: TaskCompleteRequest): Observable<Task> {
    return this.http.put<Task>(`${this.apiUrl}/${id}/completed`, request);
  }
}
