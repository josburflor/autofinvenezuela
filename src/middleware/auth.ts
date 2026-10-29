import type { Request, Response, NextFunction } from 'express';
import { verifyAdminSessionToken } from '../lib/admin-auth.ts';
import { getUserByUid } from '../db/repository.ts';
import type { AdminRole } from '../shared/types.ts';

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
    res.status(401).json({ error: 'No autorizado: Debe iniciar sesión con usuario y clave.' });
    return;
  }

  const token = authHeader.split('Bearer ')[1];

  try {
    if (!token.startsWith('autofin_adm.')) {
      res.status(401).json({ error: 'Credencial no autorizada. Inicie sesión con usuario y clave.' });
      return;
    }

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
