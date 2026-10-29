import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import type { AdminUserDTO } from '../shared/types';
import { apiFetch, tryBackendJson } from '../lib/api-url';
import { auth, googleAuthProvider } from '../lib/firebase';
import { ensureFirebaseAdminBootstrapped } from '../lib/firestore-crm';

interface AuthContextValue {
  user: AdminUserDTO | null;
  isAdmin: boolean;
  isFirebaseConnected: boolean;
  authReady: boolean;
  loading: boolean;
  authError: string | null;
  clearAuthError: () => void;
  signInWithCredentials: (identifier: string, password: string) => Promise<boolean>;
  signInWithFirebaseGoogle: () => Promise<boolean>;
  signOutAdvisor: () => Promise<void>;
  authFetch: (input: string, init?: RequestInit) => Promise<Response>;
  getAdminToken: () => string | null;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AdminUserDTO | null>(null);
  const [isFirebaseConnected, setIsFirebaseConnected] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  // Almacenamiento estrictamente en memoria
  const adminTokenRef = useRef<string | null>(null);
  const firebaseIdTokenRef = useRef<string | null>(null);

  const getAdminToken = useCallback(
    () => adminTokenRef.current || firebaseIdTokenRef.current,
    []
  );

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (fbUser) => {
      if (!fbUser) {
        firebaseIdTokenRef.current = null;
        setIsFirebaseConnected(false);
        // Si no hay sesión local con clave activa, limpiar usuario
        if (!adminTokenRef.current) {
          setUser(null);
        }
        setAuthReady(true);
        setLoading(false);
        return;
      }

      try {
        const idToken = await fbUser.getIdToken();
        firebaseIdTokenRef.current = idToken;
        const adminProfile = await ensureFirebaseAdminBootstrapped(fbUser);
        if (adminProfile) {
          setIsFirebaseConnected(true);
          if (!adminTokenRef.current) {
            setUser(adminProfile);
          }
        } else {
          await signOut(auth);
          firebaseIdTokenRef.current = null;
          setIsFirebaseConnected(false);
          if (!adminTokenRef.current) {
            setAuthError(
              'Esta cuenta de Google no está autorizada en el directorio de administradores de Autofin Venezuela.'
            );
          }
        }
      } catch (err: unknown) {
        await signOut(auth);
        firebaseIdTokenRef.current = null;
        setIsFirebaseConnected(false);
        setAuthError(
          err instanceof Error
            ? err.message
            : 'No se pudo verificar los permisos de la cuenta en Firebase.'
        );
      } finally {
        setAuthReady(true);
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  const authFetch = useCallback(async (input: string, init: RequestInit = {}) => {
    let token = adminTokenRef.current;
    if (!token && auth.currentUser) {
      try {
        token = await auth.currentUser.getIdToken();
        firebaseIdTokenRef.current = token;
      } catch {
        token = firebaseIdTokenRef.current;
      }
    }

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

  const signInWithFirebaseGoogle = useCallback(async (): Promise<boolean> => {
    setAuthError(null);
    try {
      const credential = await signInWithPopup(auth, googleAuthProvider);
      const fbUser = credential.user;

      if (!fbUser.emailVerified) {
        await signOut(auth);
        setAuthError('Su cuenta debe tener el correo electrónico verificado en Google/Firebase.');
        return false;
      }

      const idToken = await fbUser.getIdToken();
      firebaseIdTokenRef.current = idToken;

      const adminProfile = await ensureFirebaseAdminBootstrapped(fbUser);
      if (!adminProfile) {
        await signOut(auth);
        firebaseIdTokenRef.current = null;
        setAuthError(
          `La cuenta ${fbUser.email || ''} no está registrada como administrador o asesor autorizado.`
        );
        return false;
      }

      setIsFirebaseConnected(true);
      setUser(adminProfile);
      return true;
    } catch (err: unknown) {
      const code =
        err && typeof err === 'object' && 'code' in err ? String((err as { code: string }).code) : '';
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        return false;
      }
      setAuthError(
        err instanceof Error
          ? err.message
          : 'No se pudo completar el inicio de sesión con Firebase.'
      );
      return false;
    }
  }, []);

  const signInWithCredentials = useCallback(
    async (identifier: string, password: string): Promise<boolean> => {
      setAuthError(null);
      const result = await tryBackendJson<{ token: string; user: AdminUserDTO }>(
        '/api/auth/login',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ identifier, password }),
        }
      );

      if (!result.backendAvailable) {
        setAuthError(
          'En Firebase Hosting sin servidor Express activo, utilice el botón "Iniciar Sesión con Firebase" para acceder directamente a Cloud Firestore.'
        );
        return false;
      }

      if (!result.ok || !result.data) {
        setAuthError(result.error || 'Usuario o clave de acceso inválidos.');
        return false;
      }

      adminTokenRef.current = result.data.token;
      setUser(result.data.user);
      return true;
    },
    []
  );

  const signOutAdvisor = useCallback(async () => {
    const activeToken = adminTokenRef.current;
    adminTokenRef.current = null;
    firebaseIdTokenRef.current = null;
    setIsFirebaseConnected(false);
    setUser(null);
    setAuthError(null);

    if (auth.currentUser) {
      try {
        await signOut(auth);
      } catch {
        // Ignore Firebase sign-out network error
      }
    }

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
        isFirebaseConnected,
        authReady,
        loading,
        authError,
        clearAuthError,
        signInWithCredentials,
        signInWithFirebaseGoogle,
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
