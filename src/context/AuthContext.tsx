import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import type { AdminUserDTO } from '../shared/types';
import { apiFetch } from '../lib/api-url';

interface AuthContextValue {
  user: AdminUserDTO | null;
  isAdmin: boolean;
  loading: boolean;
  authError: string | null;
  clearAuthError: () => void;
  signInWithCredentials: (identifier: string, password: string) => Promise<boolean>;
  signOutAdvisor: () => Promise<void>;
  authFetch: (input: string, init?: RequestInit) => Promise<Response>;
  getAdminToken: () => string | null;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AdminUserDTO | null>(null);
  const [loading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Almacenamiento estrictamente en memoria (nunca en localStorage)
  const adminTokenRef = useRef<string | null>(null);
  const getAdminToken = useCallback(() => adminTokenRef.current, []);

  const authFetch = useCallback(async (input: string, init: RequestInit = {}) => {
    const token = adminTokenRef.current;

    const headers = new Headers(init.headers || {});
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    if (init.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    return apiFetch(input, {
      ...init,
      headers,
    });
  }, []);

  const clearAuthError = useCallback(() => {
    setAuthError(null);
  }, []);

  const signInWithCredentials = useCallback(
    async (identifier: string, password: string): Promise<boolean> => {
      setAuthError(null);
      try {
        const res = await apiFetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ identifier, password }),
        });

        const data = await res.json();
        if (!res.ok) {
          setAuthError(data.error || 'Usuario o clave de acceso inválidos.');
          return false;
        }

        adminTokenRef.current = data.token as string;
        setUser(data.user as AdminUserDTO);
        return true;
      } catch (err: unknown) {
        setAuthError(
          err instanceof Error
            ? err.message
            : 'No se pudo conectar con el servidor de autenticación.'
        );
        return false;
      }
    },
    []
  );

  const signOutAdvisor = useCallback(async () => {
    const activeToken = adminTokenRef.current;
    adminTokenRef.current = null;
    setUser(null);
    setAuthError(null);

    if (activeToken) {
      try {
        await apiFetch('/api/auth/logout', {
          method: 'POST',
          headers: { Authorization: `Bearer ${activeToken}` },
        });
      } catch {
        // Ignorar fallo de red durante cierre de sesión
      }
    }
  }, []);

  const isAdmin = Boolean(
    user && (user.role === 'super_admin' || user.role === 'admin')
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        isAdmin,
        loading,
        authError,
        clearAuthError,
        signInWithCredentials,
        signOutAdvisor,
        authFetch,
        getAdminToken,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth debe utilizarse dentro de AuthProvider');
  }
  return ctx;
}
