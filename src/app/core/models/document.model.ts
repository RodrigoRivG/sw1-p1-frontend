export type PermissionLevel = 'VIEW' | 'EDIT' | 'UPLOAD' | 'NONE';

export interface DbDocument {
  id: string;
  policyId: string;
  name: string;
  type: string;
  backblazeUrl?: string;
  currentVersionId?: string;
  createdBy: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface DocumentVersion {
  id: string;
  documentId: string;
  versionNumber: number;
  content?: string;
  backblazeUrl?: string;
  modifiedBy: string;
  modifiedAt?: string;
  changeDescription?: string;
}

export interface DocumentPermission {
  id?: string;
  documentId: string;
  nodeId: string;
  permissionLevel: PermissionLevel;
}
