import type { Admin } from '../types';
import { apiRequest } from './client';

export const authApi = {
  login(identifier: string, password: string): Promise<{ admin: Admin }> {
    return apiRequest('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier, password }),
      skipUnauthorizedEvent: true,
    });
  },
  me(): Promise<{ admin: Admin }> {
    return apiRequest('/api/auth/me', { skipUnauthorizedEvent: true });
  },
  logout(): Promise<{ success: true }> {
    return apiRequest('/api/auth/logout', {
      method: 'POST',
      skipUnauthorizedEvent: true,
    });
  },
  changePassword(
    currentPassword: string,
    newPassword: string,
    confirmPassword: string,
  ): Promise<{ success: true; redirectTo: string }> {
    return apiRequest('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
    });
  },
  logoutAll(): Promise<{ success: true }> {
    return apiRequest('/api/auth/logout-all', {
      method: 'POST',
      skipUnauthorizedEvent: true,
    });
  },
};
