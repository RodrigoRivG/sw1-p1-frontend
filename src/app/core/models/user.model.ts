export type UserRole = 'admin' | 'employee';

export interface User {
  id: number;
  email: string;
  role: UserRole;
  firstName: string;
  lastName: string;
  username?: string;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

// Respuesta plana del backend: { token, role, name, id }
export interface AuthResponse {
  token: string;
  role: UserRole;
  name: string;
  id: number;
}
