export interface Procedure {
  id: string;
  policyId?: string;
  status?: string;
  clientName?: string;
  [key: string]: any;
}

export interface ProcedureRequest {
  policyId: string;
  clientName: string;
  clientEmail: string;
  clientInfo?: {
    details?: string;
  };
}
