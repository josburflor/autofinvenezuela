import * as dotenv from 'dotenv';
dotenv.config();

import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocket, WebSocketServer } from 'ws';
import { GoogleGenAI, Modality } from '@google/genai';
import type { LiveServerMessage } from '@google/genai';

import { requireAdmin, requireAuth } from './src/middleware/auth.ts';
import type { AuthRequest } from './src/middleware/auth.ts';
import {
  issueAdminSessionToken,
  revokeAdminSessionToken,
  verifyAdminSessionToken,
} from './src/lib/admin-auth.ts';
import {
  DEFAULT_ADVISOR_PROFILE,
  DuplicateClientError,
  addLeadActivity,
  addLeadAttachment,
  authenticateAdminByCredentials,
  createAdminUserWithPassword,
  createLeadRecord,
  deleteAdminUser,
  deleteLeadAttachment,
  deleteLeadById,
  ensureMasterAdminSeeded,
  getAdvisorProfile,
  getCalculatorSettings,
  getEmailSettingsForAdmin,
  getLeadByIdWithDetails,
  getUserByUid,
  listAdminUsers,
  listAllLeadsWithDetails,
  saveAdvisorProfile,
  saveCalculatorSettings,
  saveEmailSettings,
  toggleActivityCompleted,
  updateAdminAccount,
  updateAdminPassword,
  updateLeadFields,
} from './src/db/repository.ts';
import { sendLeadConfirmationEmail, sendTestSmtpEmail } from './src/lib/mailer.ts';
import { DEFAULT_CALCULATOR_SETTINGS } from './src/shared/calculator.ts';
import {
  MAX_ADVISOR_PHOTO_BYTES,
  MAX_HERO_IMAGE_BYTES,
  OFFICIAL_OFFICE_ADDRESS,
  type AdminRole,
  type AdvisorProfileDTO,
  type CreatePublicLeadPayload,
  type EmailSettingsUpdatePayload,
} from './src/shared/types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY no está configurada en el entorno del servidor.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

const AUTOFIN_SYSTEM_INSTRUCTION = `Eres el Asesor Virtual de Autofin Venezuela y trabajas junto al asesor comercial oficial Jesús Artahona.
Ayudas tanto a los clientes visitantes como al equipo administrativo con:
1. Planes de Financiamiento de Vehículos y Motos (Nuevos 0km o Usados, Base 60 cuotas, gasto administrativo referencial $330.60):
   - Plan Entrega Garantizada 24 cuotas (inicial = 24 mensualidades + gasto adm., restan 36 cuotas fijas).
   - Plan Entrega Garantizada 17 cuotas (inicial = 17 mensualidades + gasto adm., restan 43 cuotas fijas).
   - Plan Promocional Tiempo Limitado (inicial = 4 mensualidades anticipadas + gasto adm., restan 56 cuotas).
   - Plan Ahorro (inicial = 1 mensualidad + gasto adm., sorteos mensuales, entrega garantizada en cuota 12).
2. Modalidades de Entrega Rápida:
   - Entrega Rápida 1: Inicial 55% | Entrega 25-45 días hábiles.
   - Entrega Rápida 2: Inicial 37% | Entrega 35-75 días hábiles.
   - Plan Promo 4+8: Inicial 10% | Entrega 25-45 días hábiles (cupos limitados).
   - Plan Ahorro 5%: Inicial 5% | Entrega garantizada puntualmente en la cuota 12.
3. Financiamiento de Inmuebles (Viviendas y Galpones Comerciales en Venezuela):
   - Requisito obligatorio: el solicitante ya debe tener la propiedad vista y conocer el monto total antes de procesar la solicitud.
4. Sede Oficial de Autofin Venezuela:
   - La sede principal y oficina de atención presencial está ubicada en: CC Salvamall, Valencia, Carabobo, Venezuela (NO en Caracas), con atención a solicitantes de Valencia, Carabobo y todo el país.
Responde siempre en español claro, ejecutivo y preciso en los cálculos numéricos.`;

async function startServer() {
  await ensureMasterAdminSeeded();

  const app = express();
  const httpServer = http.createServer(app);
  const crmEventsWss = new WebSocketServer({ noServer: true });
  const authenticatedCrmClients = new Set<WebSocket>();
  const allowedFrontendOrigins = new Set([
    'https://ai-studio-applet-webapp-5d2a7.web.app',
    'https://ai-studio-applet-webapp-5d2a7.firebaseapp.com',
    ...((process.env.ALLOWED_FRONTEND_ORIGINS || '').split(',').map((origin) => origin.trim()).filter(Boolean)),
  ]);

  const broadcastCrmEvent = (payload: Record<string, unknown>) => {
    const serialized = JSON.stringify(payload);
    authenticatedCrmClients.forEach((client) => {
      if (client.readyState === client.OPEN) {
        try {
          client.send(serialized);
        } catch {
          // ignore broken socket
        }
      }
    });
  };

  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && allowedFrontendOrigins.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    }
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });
  app.use(express.json({ limit: '10mb' }));

  // ============================================================================
  // AUTENTICACIÓN DE ADMINISTRADORES Y CIERRE DE SESIÓN
  // ============================================================================
  app.post('/api/auth/login', async (req, res) => {
    try {
      const { identifier, password } = req.body as {
        identifier?: string;
        password?: string;
      };

      if (!identifier?.trim() || !password) {
        res.status(400).json({ error: 'Ingrese su usuario o correo y la clave de administrador.' });
        return;
      }

      const adminUser = await authenticateAdminByCredentials(identifier, password);
      if (!adminUser) {
        res.status(401).json({ error: 'Usuario o clave de administrador incorrectos.' });
        return;
      }

      const token = issueAdminSessionToken({
        uid: adminUser.uid,
        email: adminUser.email,
        role: adminUser.role,
      });

      res.json({
        token,
        user: adminUser,
      });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'No se pudo iniciar sesión.';
      res.status(401).json({ error: message });
    }
  });

  app.post('/api/auth/logout', (req, res) => {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split('Bearer ')[1];
      revokeAdminSessionToken(token);
    }
    res.json({ loggedOut: true });
  });

  app.get('/api/auth/me', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Sesión no válida.' });
        return;
      }
      const profile = await getUserByUid(req.user.uid);
      if (!profile) {
        res.status(404).json({ error: 'Perfil de administrador no encontrado.' });
        return;
      }
      res.json(profile);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Error al verificar sesión.';
      res.status(500).json({ error: message });
    }
  });

  // ============================================================================
  // GESTIÓN DE ADMINISTRADORES Y CREACIÓN DE CLAVES (Solo Administradores)
  // ============================================================================
  app.get('/api/crm/admins', requireAuth, requireAdmin, async (_req: AuthRequest, res) => {
    try {
      const admins = await listAdminUsers();
      res.json(admins);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Error al listar administradores.';
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/crm/admins', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { displayName, username, email, password, role } = req.body as {
        displayName?: string;
        username?: string;
        email?: string;
        password?: string;
        role?: AdminRole;
      };

      if (!displayName?.trim() || !username?.trim() || !email?.trim() || !password) {
        res.status(400).json({
          error: 'Complete nombre, usuario, correo y la clave de acceso del nuevo administrador.',
        });
        return;
      }

      const validRole: AdminRole =
        role === 'super_admin' || role === 'admin' || role === 'asesor' ? role : 'admin';

      const createdBy = req.user?.name || req.user?.email || 'Administrador';
      const created = await createAdminUserWithPassword({
        displayName,
        username,
        email,
        password,
        role: validRole,
        createdBy,
      });

      res.status(201).json(created);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'No se pudo crear la cuenta de administrador.';
      res.status(400).json({ error: message });
    }
  });

  app.patch(
    '/api/crm/admins/:uid/password',
    requireAuth,
    requireAdmin,
    async (req: AuthRequest, res) => {
      try {
        const targetUid = String(req.params.uid);
        const { password } = req.body as { password?: string };

        if (!password || password.length < 6) {
          res.status(400).json({
            error: 'La nueva clave del administrador debe tener al menos 6 caracteres.',
          });
          return;
        }

        const updated = await updateAdminPassword(targetUid, password);
        res.json(updated);
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : 'No se pudo actualizar la clave.';
        res.status(400).json({ error: message });
      }
    }
  );

  app.patch('/api/crm/admins/:uid', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const targetUid = String(req.params.uid);
      const { isActive, role, displayName, username } = req.body as {
        isActive?: boolean;
        role?: AdminRole;
        displayName?: string;
        username?: string;
      };

      if (targetUid === req.user?.uid) {
        if (isActive === false) {
          res.status(400).json({
            error: 'No puede suspender su propia cuenta con sesión activa.',
          });
          return;
        }
        if (role && role === 'asesor') {
          res.status(400).json({
            error: 'No puede retirarse sus propios permisos de administrador.',
          });
          return;
        }
      }

      const updated = await updateAdminAccount(targetUid, {
        isActive,
        role,
        displayName,
        username,
      });
      res.json(updated);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'No se pudo actualizar el administrador.';
      res.status(400).json({ error: message });
    }
  });

  app.delete('/api/crm/admins/:uid', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const targetUid = String(req.params.uid);
      if (targetUid === req.user?.uid) {
        res.status(400).json({
          error: 'No puede eliminar su propia cuenta de administrador mientras está en sesión.',
        });
        return;
      }

      const result = await deleteAdminUser(targetUid);
      res.json(result);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'No se pudo eliminar el administrador.';
      res.status(400).json({ error: message });
    }
  });

  // ============================================================================
  // RUTAS PÚBLICAS (Captación Web, Perfil del Asesor, Calculadora y Asistente IA)
  // ============================================================================
  app.get('/api/public/advisor-profile', async (_req, res) => {
    try {
      const profile = await getAdvisorProfile();
      res.json(profile);
    } catch (error) {
      console.error('Fallback to default advisor profile:', error);
      res.json(DEFAULT_ADVISOR_PROFILE);
    }
  });

  app.put('/api/crm/advisor-profile', requireAuth, async (req: AuthRequest, res) => {
    try {
      const body = req.body as Partial<AdvisorProfileDTO>;

      const validateDataImageSize = (
        dataUrl: string | null | undefined,
        maxBytes: number,
        label: string
      ): string | null => {
        if (!dataUrl || !dataUrl.startsWith('data:')) return null;
        const commaIdx = dataUrl.indexOf(',');
        if (commaIdx === -1) return `Formato de imagen inválido en ${label}.`;
        const meta = dataUrl.slice(0, commaIdx);
        if (!meta.startsWith('data:image/')) {
          return `El archivo seleccionado en ${label} debe ser una imagen válida.`;
        }
        const base64Data = dataUrl.slice(commaIdx + 1);
        const binaryBytes = Buffer.from(base64Data, 'base64').byteLength;
        if (binaryBytes > maxBytes) {
          const kb = (binaryBytes / 1024).toFixed(1);
          const maxKb = Math.round(maxBytes / 1024);
          return `${label} pesa ${kb} KB y supera el límite máximo permitido de ${maxKb} KB.`;
        }
        return null;
      };

      const photoErr = validateDataImageSize(
        body.photoUrl,
        MAX_ADVISOR_PHOTO_BYTES,
        'La foto del asesor'
      );
      if (photoErr) {
        res.status(400).json({ error: photoErr });
        return;
      }

      for (const [heroField, heroLabel] of [
        [body.heroVehiculoUrl, 'La imagen Hero de Vehículos'],
        [body.heroMotoUrl, 'La imagen Hero de Motos'],
        [body.heroInmuebleUrl, 'La imagen Hero de Inmuebles'],
      ] as const) {
        const heroErr = validateDataImageSize(heroField, MAX_HERO_IMAGE_BYTES, heroLabel);
        if (heroErr) {
          res.status(400).json({ error: heroErr });
          return;
        }
      }

      const saved = await saveAdvisorProfile(body);
      res.json(saved);
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : 'No se pudo actualizar el perfil e imágenes de Captación Web.';
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/public/gemini/chat', async (req, res) => {
    try {
      const { message, history = [] } = req.body as {
        message?: string;
        history?: Array<{ role: 'user' | 'model'; text: string }>;
      };

      if (!message?.trim()) {
        res.status(400).json({ error: 'El mensaje no puede estar vacío.' });
        return;
      }

      const profile = await getAdvisorProfile();
      const ai = getGeminiClient();
      const selectedModel = 'gemini-3.8-flash';

      const publicSystemInstruction = `${AUTOFIN_SYSTEM_INSTRUCTION}
Estás atendiendo directamente a un cliente visitante en la página pública de Captación Web de Autofin Venezuela.
Nuestra sede oficial se encuentra en: ${profile.officeAddress || OFFICIAL_OFFICE_ADDRESS}.
El asesor comercial asignado que atenderá su solicitud es ${profile.advisorName} (${profile.advisorTitle}).
Orienta al cliente con amabilidad, calcula ejemplos claros a 60 cuotas si te indica el precio de un vehículo, moto o inmueble, recuérdale que en la misma página tiene la Calculadora Interactiva y anímalo a registrar sus datos en el formulario de Captación Web para que ${profile.advisorName} se comunique directamente con él.`;

      const formattedHistory = history
        .slice(-12)
        .filter((h) => h.text && (h.role === 'user' || h.role === 'model'))
        .map((h) => ({
          role: h.role,
          parts: [{ text: h.text }],
        }));

      const chat = ai.chats.create({
        model: selectedModel,
        history: formattedHistory,
        config: {
          systemInstruction: publicSystemInstruction,
        },
      });

      const response = await chat.sendMessage({
        message: message.trim(),
      });

      res.json({
        reply: response.text || '',
        model: selectedModel,
      });
    } catch (error: unknown) {
      console.error('Public Gemini chat error:', error);
      const rawMessage = error instanceof Error ? error.message : String(error);
      res.status(500).json({
        error: `Error al consultar al asistente de IA: ${rawMessage}`,
      });
    }
  });

  app.get('/api/public/calculator-settings', async (_req, res) => {
    try {
      const settings = await getCalculatorSettings();
      res.json(settings);
    } catch (error) {
      console.error('Fallback to default calculator settings:', error);
      res.json(DEFAULT_CALCULATOR_SETTINGS);
    }
  });

  app.post('/api/public/leads', async (req, res) => {
    try {
      const body = req.body as CreatePublicLeadPayload;

      if (
        !body.firstName?.trim() ||
        !body.lastName?.trim() ||
        !body.cedula?.trim() ||
        !body.phone?.trim() ||
        !body.email?.trim() ||
        !body.city?.trim() ||
        body.availableAmount === undefined ||
        Number(body.availableAmount) < 0 ||
        (body.interestType !== 'vehiculo' &&
          body.interestType !== 'moto' &&
          body.interestType !== 'inmueble')
      ) {
        res.status(400).json({
          error: 'Todos los campos personales y el monto disponible son obligatorios.',
        });
        return;
      }

      if (body.interestType === 'vehiculo' || body.interestType === 'moto') {
        if (
          !body.vehicle ||
          (body.vehicle.condition !== 'Nuevo' && body.vehicle.condition !== 'Usado') ||
          !body.vehicle.year ||
          !body.vehicle.brand?.trim() ||
          !body.vehicle.model?.trim()
        ) {
          res.status(400).json({
            error:
              body.interestType === 'moto'
                ? 'Para financiamiento de moto debe indicar condición (Nueva/Usada), año, marca y modelo.'
                : 'Para financiamiento de vehículo debe indicar condición (Nuevo/Usado), año, marca y modelo.',
          });
          return;
        }
      }

      if (body.interestType === 'inmueble') {
        if (!body.property?.propertySeenConfirmed) {
          res.status(400).json({
            error: 'Debe confirmar que ya tiene la propiedad vista y conoce su monto.',
          });
          return;
        }
      }

      const created = await createLeadRecord({
        ...body,
        availableAmount: Number(body.availableAmount),
        source: 'Formulario Web',
      });

      let responseLead: Record<string, unknown> | null = created;
      if (created) {
        const currentProfile = await getAdvisorProfile();
        const emailDelivery = await sendLeadConfirmationEmail(
          created,
          currentProfile,
          'Sistema Automático de Captación Web'
        );
        const refreshedAfterEmail = emailDelivery.sent
          ? await getLeadByIdWithDetails(created.id)
          : created;
        responseLead = refreshedAfterEmail
          ? { ...refreshedAfterEmail, emailDelivery }
          : { ...created, emailDelivery };

        broadcastCrmEvent({
          type: 'NEW_WEB_LEAD',
          lead: responseLead,
          timestamp: new Date().toISOString(),
        });
      }

      res.status(201).json(responseLead);
    } catch (error: unknown) {
      if (error instanceof DuplicateClientError) {
        res.status(409).json({ error: error.message, field: error.field });
        return;
      }
      const message =
        error instanceof Error ? error.message : 'Error al registrar la solicitud.';
      res.status(500).json({ error: message });
    }
  });

  // ============================================================================
  // RUTAS PROTEGIDAS DEL CRM (Requieren Autenticación de Asesor)
  // ============================================================================
  app.get('/api/crm/leads', requireAuth, async (_req: AuthRequest, res) => {
    try {
      const list = await listAllLeadsWithDetails();
      res.json(list);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Error al cargar los prospectos.';
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/crm/leads', requireAuth, async (req: AuthRequest, res) => {
    try {
      const body = req.body as CreatePublicLeadPayload;
      const created = await createLeadRecord({
        ...body,
        availableAmount: Number(body.availableAmount),
        source: body.source || 'Asesor CRM',
      });
      res.status(201).json(created);
    } catch (error: unknown) {
      if (error instanceof DuplicateClientError) {
        res.status(409).json({ error: error.message, field: error.field });
        return;
      }
      const message =
        error instanceof Error ? error.message : 'Error al crear el cliente.';
      res.status(500).json({ error: message });
    }
  });

  app.get('/api/crm/leads/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const leadId = Number(req.params.id);
      const record = await getLeadByIdWithDetails(leadId);
      if (!record) {
        res.status(404).json({ error: 'Cliente no encontrado.' });
        return;
      }
      res.json(record);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Error al obtener la ficha del cliente.';
      res.status(500).json({ error: message });
    }
  });

  app.patch('/api/crm/leads/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const leadId = Number(req.params.id);
      const updated = await updateLeadFields(leadId, req.body);
      res.json(updated);
    } catch (error: unknown) {
      if (error instanceof DuplicateClientError) {
        res.status(409).json({ error: error.message, field: error.field });
        return;
      }
      const message =
        error instanceof Error ? error.message : 'Error al actualizar el cliente.';
      res.status(500).json({ error: message });
    }
  });

  app.delete('/api/crm/leads/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const leadId = Number(req.params.id);
      if (!Number.isFinite(leadId) || leadId <= 0) {
        res.status(400).json({ error: 'Identificador de cliente inválido.' });
        return;
      }

      const result = await deleteLeadById(leadId);
      broadcastCrmEvent({
        type: 'LEAD_DELETED',
        leadId,
        timestamp: new Date().toISOString(),
      });
      res.json(result);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'No se pudo eliminar el cliente.';
      res.status(400).json({ error: message });
    }
  });

  app.post('/api/crm/leads/:id/activities', requireAuth, async (req: AuthRequest, res) => {
    try {
      const leadId = Number(req.params.id);
      const { activityType, title, description, scheduledAt, reminderEnabled, completed } =
        req.body;

      if (!activityType || !title?.trim() || !description?.trim()) {
        res.status(400).json({ error: 'Tipo, título y detalle de la actividad son obligatorios.' });
        return;
      }

      const advisorName =
        req.user?.name || req.user?.email?.split('@')[0] || 'Asesor Autofin';

      await addLeadActivity({
        leadId,
        advisorUid: req.user?.uid || null,
        advisorName,
        activityType,
        title,
        description,
        scheduledAt: scheduledAt || null,
        reminderEnabled: Boolean(reminderEnabled),
        completed: Boolean(completed),
      });

      const refreshed = await getLeadByIdWithDetails(leadId);
      res.status(201).json(refreshed);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Error al guardar la actividad.';
      res.status(500).json({ error: message });
    }
  });

  app.patch('/api/crm/activities/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const activityId = Number(req.params.id);
      const updated = await toggleActivityCompleted(activityId, Boolean(req.body.completed));
      res.json(updated);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Error al actualizar la actividad.';
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/crm/leads/:id/sms', requireAuth, async (req: AuthRequest, res) => {
    try {
      const leadId = Number(req.params.id);
      const { phone, message } = req.body as { phone?: string; message?: string };

      if (!phone?.trim() || !message?.trim()) {
        res.status(400).json({ error: 'Número de destino y mensaje SMS son obligatorios.' });
        return;
      }

      const advisorName =
        req.user?.name || req.user?.email?.split('@')[0] || 'Asesor Autofin';

      await addLeadActivity({
        leadId,
        advisorUid: req.user?.uid || null,
        advisorName,
        activityType: 'sms',
        title: `SMS enviado a ${phone}`,
        description: message.trim(),
        completed: true,
      });

      const refreshed = await getLeadByIdWithDetails(leadId);
      res.status(201).json({
        dispatched: true,
        lead: refreshed,
      });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Error al registrar el envío de SMS.';
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/crm/leads/:id/attachments', requireAuth, async (req: AuthRequest, res) => {
    try {
      const leadId = Number(req.params.id);
      const { fileName, mimeType, fileSize, dataUrl, caption } = req.body;

      if (!fileName || !mimeType || !dataUrl) {
        res.status(400).json({ error: 'Archivo inválido o incompleto.' });
        return;
      }

      const advisorName =
        req.user?.name || req.user?.email?.split('@')[0] || 'Asesor Autofin';

      await addLeadAttachment({
        leadId,
        fileName,
        mimeType,
        fileSize: Number(fileSize) || 0,
        dataUrl,
        caption: caption || '',
        uploadedBy: advisorName,
      });

      const refreshed = await getLeadByIdWithDetails(leadId);
      res.status(201).json(refreshed);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Error al subir el archivo adjunto.';
      res.status(500).json({ error: message });
    }
  });

  app.delete('/api/crm/attachments/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const attachmentId = Number(req.params.id);
      const result = await deleteLeadAttachment(attachmentId);
      res.json(result);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Error al eliminar adjunto.';
      res.status(500).json({ error: message });
    }
  });

  app.put('/api/crm/calculator-settings', requireAuth, async (req: AuthRequest, res) => {
    try {
      const saved = await saveCalculatorSettings(req.body);
      res.json(saved);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Error al actualizar configuración de planes.';
      res.status(500).json({ error: message });
    }
  });

  app.get('/api/crm/email-settings', requireAuth, async (_req: AuthRequest, res) => {
    try {
      const cfg = await getEmailSettingsForAdmin();
      res.json(cfg);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'No se pudo obtener la configuración de correo.';
      res.status(500).json({ error: message });
    }
  });

  app.put('/api/crm/email-settings', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const body = req.body as EmailSettingsUpdatePayload;
      const saved = await saveEmailSettings(body);
      res.json(saved);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'No se pudo guardar la configuración de correo.';
      res.status(500).json({ error: message });
    }
  });

  app.post(
    '/api/crm/email-settings/test',
    requireAuth,
    requireAdmin,
    async (req: AuthRequest, res) => {
      try {
        const { recipientEmail } = req.body as { recipientEmail?: string };
        if (!recipientEmail?.trim()) {
          res.status(400).json({ error: 'Indique el correo electrónico destino para la prueba.' });
          return;
        }
        const profile = await getAdvisorProfile();
        const result = await sendTestSmtpEmail(recipientEmail.trim(), profile);
        res.json(result);
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : 'Error al enviar correo de prueba SMTP.';
        res.status(400).json({ error: message });
      }
    }
  );

  app.post(
    '/api/crm/leads/:id/send-confirmation-email',
    requireAuth,
    async (req: AuthRequest, res) => {
      try {
        const leadId = Number(req.params.id);
        const lead = await getLeadByIdWithDetails(leadId);
        if (!lead) {
          res.status(404).json({ error: 'Cliente no encontrado.' });
          return;
        }
        const profile = await getAdvisorProfile();
        const senderLabel = req.user?.name || profile.advisorName || 'Asesor Autofin';
        const delivery = await sendLeadConfirmationEmail(lead, profile, senderLabel);
        if (!delivery.sent) {
          res.status(400).json({ error: delivery.message, emailDelivery: delivery });
          return;
        }
        const refreshed = await getLeadByIdWithDetails(leadId);
        res.json({
          lead: refreshed,
          emailDelivery: delivery,
        });
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : 'No se pudo enviar el correo al cliente.';
        res.status(500).json({ error: message });
      }
    }
  );

  // ============================================================================
  // GEMINI MULTI-TURN CHATBOT API (Server-Side Only)
  // ============================================================================
  app.post('/api/gemini/chat', requireAuth, async (req: AuthRequest, res) => {
    try {
      const {
        message,
        history = [],
        mode = 'standard',
        leadContext = '',
      } = req.body as {
        message?: string;
        history?: Array<{ role: 'user' | 'model'; text: string }>;
        mode?: 'standard' | 'fast';
        leadContext?: string;
      };

      if (!message?.trim()) {
        res.status(400).json({ error: 'El mensaje no puede estar vacío.' });
        return;
      }

      const ai = getGeminiClient();
      const selectedModel = mode === 'fast' ? 'gemini-3.1-flash-lite' : 'gemini-3.8-flash';

      const roleInstruction =
        mode === 'fast'
          ? `${AUTOFIN_SYSTEM_INSTRUCTION}\nModo Rápido Activado: Redacta respuestas concisas, cordiales y listas para pegar en WhatsApp o SMS en menos de 90 palabras.`
          : `${AUTOFIN_SYSTEM_INSTRUCTION}${leadContext ? `\n\nContexto actual del cliente en pantalla:\n${leadContext}` : ''}`;

      const formattedHistory = history
        .filter((h) => h.text && (h.role === 'user' || h.role === 'model'))
        .map((h) => ({
          role: h.role,
          parts: [{ text: h.text }],
        }));

      const chat = ai.chats.create({
        model: selectedModel,
        history: formattedHistory,
        config: {
          systemInstruction: roleInstruction,
        },
      });

      const response = await chat.sendMessage({
        message: message.trim(),
      });

      res.json({
        reply: response.text || '',
        model: selectedModel,
      });
    } catch (error: unknown) {
      console.error('Gemini chat error:', error);
      const rawMessage = error instanceof Error ? error.message : String(error);
      res.status(500).json({
        error: `Error al consultar al asistente Gemini: ${rawMessage}`,
      });
    }
  });

  // ============================================================================
  // GEMINI LIVE API REAL-TIME VOICE WEBSOCKET (/live -> gemini-3.8-live)
  // ============================================================================
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (request, socket, head) => {
    const reqUrl = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    const origin = request.headers.origin;
    let sameOrigin = false;
    try {
      sameOrigin = Boolean(origin && new URL(origin).host === request.headers.host);
    } catch {
      sameOrigin = false;
    }
    if (origin && !allowedFrontendOrigins.has(origin) && !sameOrigin) {
      socket.destroy();
      return;
    }
    if (reqUrl.pathname === '/live') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } else if (reqUrl.pathname === '/ws/crm-events') {
      crmEventsWss.handleUpgrade(request, socket, head, (ws) => {
        crmEventsWss.emit('connection', ws, request);
      });
    }
  });

  crmEventsWss.on('connection', (clientWs) => {
    const authTimeout = setTimeout(() => clientWs.close(1008, 'Autenticación requerida'), 5000);
    clientWs.once('message', async (raw) => {
      clearTimeout(authTimeout);
      try {
        const message = JSON.parse(raw.toString()) as { type?: string; token?: string };
        const claims = message.type === 'AUTH' && message.token
          ? verifyAdminSessionToken(message.token)
          : null;
        const user = claims ? await getUserByUid(claims.uid) : null;
        if (!user?.isActive) {
          clientWs.close(1008, 'No autorizado');
          return;
        }
        authenticatedCrmClients.add(clientWs);
      } catch {
        clientWs.close(1008, 'No autorizado');
      }
    });
    clientWs.on('close', () => {
      clearTimeout(authTimeout);
      authenticatedCrmClients.delete(clientWs);
    });
  });

  wss.on('connection', (clientWs, request) => {
    const reqUrl = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    const leadSummary = reqUrl.searchParams.get('lead') || '';

    let closed = false;
    let activeSession: { close: () => void } | null = null;

    let ai: GoogleGenAI;
    try {
      ai = getGeminiClient();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Falta GEMINI_API_KEY.';
      clientWs.send(JSON.stringify({ error: msg }));
      clientWs.close();
      return;
    }

    const sessionPromise = ai.live.connect({
      model: 'gemini-3.8-live',
      config: {
        responseModalities: [Modality.AUDIO],
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Zephyr' },
          },
        },
        systemInstruction: `${AUTOFIN_SYSTEM_INSTRUCTION}\nEstás en una conversación de voz en tiempo real con un asesor comercial de Autofin Venezuela. Habla de forma natural, clara y ejecutiva.${
          leadSummary ? `\nCliente actual: ${leadSummary}` : ''
        }`,
      },
      callbacks: {
        onopen: () => {
          if (!closed && clientWs.readyState === clientWs.OPEN) {
            clientWs.send(JSON.stringify({ status: 'connected' }));
          }
        },
        onmessage: (message: LiveServerMessage) => {
          if (closed || clientWs.readyState !== clientWs.OPEN) return;

          const parts = message.serverContent?.modelTurn?.parts || [];
          for (const part of parts) {
            const audioData = part.inlineData?.data;
            if (audioData) {
              clientWs.send(JSON.stringify({ audio: audioData }));
            }
          }

          const inputText = message.serverContent?.inputTranscription?.text;
          if (inputText) {
            clientWs.send(JSON.stringify({ inputTranscript: inputText }));
          }

          const outputText = message.serverContent?.outputTranscription?.text;
          if (outputText) {
            clientWs.send(JSON.stringify({ outputTranscript: outputText }));
          }

          if (message.serverContent?.interrupted) {
            clientWs.send(JSON.stringify({ interrupted: true }));
          }
        },
        onerror: (err: unknown) => {
          console.error('Gemini Live session error:', err);
          if (!closed && clientWs.readyState === clientWs.OPEN) {
            clientWs.send(
              JSON.stringify({
                error: 'Error en la sesión de voz en vivo con Gemini.',
              })
            );
          }
        },
        onclose: () => {
          if (!closed && clientWs.readyState === clientWs.OPEN) {
            clientWs.close();
          }
        },
      },
    });

    sessionPromise
      .then((session) => {
        activeSession = session;
        if (closed) {
          session.close();
        }
      })
      .catch((err: unknown) => {
        console.error('Failed to connect Gemini Live session:', err);
        if (!closed && clientWs.readyState === clientWs.OPEN) {
          const msg = err instanceof Error ? err.message : 'Error de conexión Live API';
          clientWs.send(JSON.stringify({ error: msg }));
          clientWs.close();
        }
      });

    clientWs.on('message', (raw) => {
      try {
        const parsed = JSON.parse(raw.toString()) as { audio?: string; text?: string };
        if (parsed.audio) {
          sessionPromise
            .then((session) => {
              if (!closed) {
                session.sendRealtimeInput({
                  audio: {
                    data: parsed.audio!,
                    mimeType: 'audio/pcm;rate=16000',
                  },
                });
              }
            })
            .catch(() => {});
        } else if (parsed.text) {
          sessionPromise
            .then((session) => {
              if (!closed) {
                session.sendRealtimeInput({
                  text: parsed.text!,
                });
              }
            })
            .catch(() => {});
        }
      } catch (e) {
        console.error('Invalid WS message from client:', e);
      }
    });

    clientWs.on('close', () => {
      closed = true;
      if (activeSession) {
        try {
          activeSession.close();
        } catch {
          // ignore close errors
        }
      }
    });
  });

  // ============================================================================
  // VITE DEV MIDDLEWARE / STATIC ASSETS EN PRODUCCIÓN
  // ============================================================================
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const PORT = Number(process.env.PORT) || 3000;
  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Autofin Venezuela CRM server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
