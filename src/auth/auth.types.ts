import type { Request } from 'express';

export interface SafeAdmin {
  id: string;
  username: string;
  email: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthenticatedRequest extends Request {
  admin: SafeAdmin;
  sessionId: string;
}

export const SAFE_ADMIN_SELECT = {
  id: true,
  username: true,
  email: true,
  createdAt: true,
  updatedAt: true,
} as const;
