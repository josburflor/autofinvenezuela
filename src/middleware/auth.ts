import type { Request, Response, NextFunction } from 'express';
import { verifyAdminSessionToken } from '../lib/admin-auth.ts';
import { adminAuth } from '../lib/firebase-admin.ts';
import { getUserByUid } from '../db/repository.ts';
import type { AdminRole } from '../shared/types.ts';

export const BOOTSTRAPPED_ADMIN_EMAIL = 'josburflor@gmail.com';

export interface AuthenticatedAdvisor {
  uid: string;
  email: string;
  username?: string | null;
  name: string;
  role: AdminRole;
}

export interface AuthRequest extends Request {
  user?: AuthenticatedAdvisor;
}

export const requireAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'No autorizado: Debe iniciar sesión en el panel administrativo.' });
    return;
  }

  const token = authHeader.split('Bearer ')[1];

  try {
    if (token.startsWith('autofin_adm.')) {
      const claims = verifyAdminSessionToken(token);
      if (!claims) {
        res.status(401).json({ error: 'Sesión cerrada o expirada. Inicie sesión nuevamente.' });
        return;
      }

      const dbUser = await getUserByUid(claims.uid);
      if (!dbUser || !dbUser.isActive) {
        res.status(401).json({ error: 'Cuenta de administrador inactiva o no autorizada.' });
        return;
      }

      req.user = {
        uid: dbUser.uid,
        email: dbUser.email,
        username: dbUser.username,
        name: dbUser.displayName || dbUser.username || dbUser.email.split('@')[0],
        role: dbUser.role,
      };
      next();
      return;
    }

    // Verificación de Firebase ID Token para sesión unificada con Cloud Firestore
    const decoded = await adminAuth.verifyIdToken(token);
    if (!decoded.email || decoded.email_verified !== true) {
      res.status(401).json({ error: 'Se requiere una cuenta Firebase con correo verificado.' });
      return;
    }

    const cleanEmail = decoded.email.trim().toLowerCase();
    const dbUser = await getUserByUid(decoded.uid);

    if (cleanEmail === BOOTSTRAPPED_ADMIN_EMAIL) {
      req.user = {
        uid: decoded.uid,
        email: cleanEmail,
        username: 'admin-firebase',
        name: decoded.name || dbUser?.displayName || 'Jesús Artahona',
        role: 'super_admin',
      };
      next();
      return;
    }

    if (!dbUser || !dbUser.isActive) {
      res.status(403).json({
        error: 'Su cuenta Firebase no está autorizada en el directorio de administradores.',
      });
      return;
    }

    req.user = {
      uid: dbUser.uid,
      email: dbUser.email,
      username: dbUser.username,
      name: dbUser.displayName || decoded.name || dbUser.email.split('@')[0],
      role: dbUser.role,
    };
    next();
  } catch (error) {
    console.error('Error verifying session token:', error);
    res.status(401).json({ error: 'Sesión inválida o expirada. Inicia sesión nuevamente.' });
  }
};

export const requireAdmin = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  if (!req.user || (req.user.role !== 'super_admin' && req.user.role !== 'admin')) {
    res.status(403).json({
      error: 'Acceso restringido: Solo un administrador puede ejecutar esta configuración.',
    });
    return;
  }
  next();
};
