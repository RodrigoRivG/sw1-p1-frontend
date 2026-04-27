export type PolicyStatus = 'DRAFT' | 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';

export interface Policy {
  id: string;
  name: string;
  description: string;
  createdBy: string;
  status: PolicyStatus;
  diagram: Record<string, unknown>;
  collaborators: string[];
}

// Coincide exactamente con PolicyRequest del backend
export interface PolicyRequest {
  name: string;
  description: string;
  createdBy?: string;        // el backend lo puede tomar de Authentication
  diagram?: Record<string, unknown>;
  status?: string;
  collaborators?: string[];
}
