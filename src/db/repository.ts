import crypto from 'node:crypto';
import { asc, desc, eq } from 'drizzle-orm';
import { db } from './index.ts';
import {
  advisorProfile,
  calculatorSettings,
  emailSettings,
  leadActivities,
  leadAttachments,
  leads,
  propertyRequests,
  users,
  vehicleRequests,
} from './schema.ts';
import {
  DEFAULT_ADVISOR_PHOTO_URL,
  OFFICIAL_OFFICE_ADDRESS,
  type AdminRole,
  type AdminUserDTO,
  type AdvisorProfileDTO,
  type CalculatorSettingsDTO,
  type CreatePublicLeadPayload,
  type EmailSettingsDTO,
  type EmailSettingsUpdatePayload,
  type LeadStatus,
} from '../shared/types.ts';
import { DEFAULT_CALCULATOR_SETTINGS } from '../shared/calculator.ts';
import { hashAdminPassword, verifyAdminPassword } from '../lib/admin-auth.ts';

export const DEFAULT_MASTER_ADMIN_UID = 'admin-master-autofin';

export const DEFAULT_ADVISOR_PROFILE: AdvisorProfileDTO = {
  advisorName: 'Jesús Artahona',
  advisorTitle: 'Asesor Comercial Oficial · Autofin Venezuela',
  photoUrl: DEFAULT_ADVISOR_PHOTO_URL,
  welcomeBio:
    'Atención personalizada desde nuestra sede en CC Salvamall, Valencia, Carabobo, en planes de compra programada y entrega garantizada para vehículos, motos e inmuebles.',
  officeAddress: OFFICIAL_OFFICE_ADDRESS,
  heroTitle: 'Planifica tu vehículo, moto o inmueble con cuotas fijas',
  heroSubtitle: 'Sede Oficial · CC Salvamall, Valencia, Carabobo',
  heroVehiculoUrl: null,
  heroMotoUrl: null,
  heroInmuebleUrl: null,
};

function mapUserToAdminDTO(row: typeof users.$inferSelect): AdminUserDTO {
  const normalizedRole: AdminRole =
    row.role === 'super_admin' || row.role === 'admin' || row.role === 'asesor'
      ? row.role
      : 'admin';

  return {
    uid: row.uid,
    username: row.username || null,
    email: row.email,
    displayName: row.displayName || null,
    role: normalizedRole,
    hasPassword: Boolean(row.passwordHash),
    isActive: row.isActive !== false,
    createdBy: row.createdBy || null,
    lastLoginAt: row.lastLoginAt ? row.lastLoginAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function ensureMasterAdminSeeded(): Promise<void> {
  try {
    const existingMaster = await db
      .select()
      .from(users)
      .where(eq(users.uid, DEFAULT_MASTER_ADMIN_UID));

    if (existingMaster.length === 0) {
      await db.insert(users).values({
        uid: DEFAULT_MASTER_ADMIN_UID,
        username: 'admin',
        email: 'admin@autofinvenezuela.com',
        displayName: 'Jesús Artahona',
        role: 'super_admin',
        passwordHash: hashAdminPassword('Autofin2026*'),
        isActive: true,
        createdBy: 'Sistema Inicial',
      });
    }

    const existingProfile = await db.select().from(advisorProfile);
    if (existingProfile.length === 0) {
      await db.insert(advisorProfile).values({
        advisorName: DEFAULT_ADVISOR_PROFILE.advisorName,
        advisorTitle: DEFAULT_ADVISOR_PROFILE.advisorTitle,
        photoUrl: DEFAULT_ADVISOR_PROFILE.photoUrl,
        welcomeBio: DEFAULT_ADVISOR_PROFILE.welcomeBio,
        officeAddress: DEFAULT_ADVISOR_PROFILE.officeAddress,
        heroTitle: DEFAULT_ADVISOR_PROFILE.heroTitle,
        heroSubtitle: DEFAULT_ADVISOR_PROFILE.heroSubtitle,
        heroVehiculoUrl: null,
        heroMotoUrl: null,
        heroInmuebleUrl: null,
      });
    }
  } catch (error) {
    console.error('Failed to seed master administrator:', error);
  }
}

export async function getAdvisorProfile(): Promise<AdvisorProfileDTO> {
  try {
    const rows = await db
      .select()
      .from(advisorProfile)
      .orderBy(desc(advisorProfile.id));

    if (!rows.length) {
      return DEFAULT_ADVISOR_PROFILE;
    }

    const r = rows[0];
    return {
      id: r.id,
      advisorName: r.advisorName,
      advisorTitle: r.advisorTitle,
      photoUrl: r.photoUrl,
      welcomeBio: r.welcomeBio,
      officeAddress: r.officeAddress || OFFICIAL_OFFICE_ADDRESS,
      heroTitle: r.heroTitle || DEFAULT_ADVISOR_PROFILE.heroTitle,
      heroSubtitle: r.heroSubtitle || DEFAULT_ADVISOR_PROFILE.heroSubtitle,
      heroVehiculoUrl: r.heroVehiculoUrl || null,
      heroMotoUrl: r.heroMotoUrl || null,
      heroInmuebleUrl: r.heroInmuebleUrl || null,
      updatedAt: r.updatedAt.toISOString(),
    };
  } catch (error) {
    console.error('Database query failed in getAdvisorProfile:', error);
    return DEFAULT_ADVISOR_PROFILE;
  }
}

export async function saveAdvisorProfile(
  input: Partial<AdvisorProfileDTO>
): Promise<AdvisorProfileDTO> {
  try {
    const existing = await db
      .select()
      .from(advisorProfile)
      .orderBy(desc(advisorProfile.id));

    const current = existing[0] || DEFAULT_ADVISOR_PROFILE;

    const resolveNullableUrl = (
      nextVal: string | null | undefined,
      prevVal: string | null | undefined
    ): string | null => {
      if (nextVal === undefined) return prevVal || null;
      if (nextVal === null) return null;
      const trimmed = nextVal.trim();
      return trimmed.length > 0 ? trimmed : null;
    };

    const values = {
      advisorName: input.advisorName?.trim() || current.advisorName,
      advisorTitle: input.advisorTitle?.trim() || current.advisorTitle,
      photoUrl: input.photoUrl?.trim() || current.photoUrl,
      welcomeBio: input.welcomeBio?.trim() || current.welcomeBio,
      officeAddress:
        input.officeAddress?.trim() || current.officeAddress || OFFICIAL_OFFICE_ADDRESS,
      heroTitle:
        input.heroTitle?.trim() || current.heroTitle || DEFAULT_ADVISOR_PROFILE.heroTitle,
      heroSubtitle:
        input.heroSubtitle?.trim() ||
        current.heroSubtitle ||
        DEFAULT_ADVISOR_PROFILE.heroSubtitle,
      heroVehiculoUrl: resolveNullableUrl(input.heroVehiculoUrl, current.heroVehiculoUrl),
      heroMotoUrl: resolveNullableUrl(input.heroMotoUrl, current.heroMotoUrl),
      heroInmuebleUrl: resolveNullableUrl(input.heroInmuebleUrl, current.heroInmuebleUrl),
      updatedAt: new Date(),
    };

    if (existing.length > 0) {
      await db
        .update(advisorProfile)
        .set(values)
        .where(eq(advisorProfile.id, existing[0].id));
    } else {
      await db.insert(advisorProfile).values(values);
    }

    return await getAdvisorProfile();
  } catch (error) {
    console.error('Database query failed in saveAdvisorProfile:', error);
    throw new Error('No se pudo actualizar el perfil y portal en la base de datos.', {
      cause: error,
    });
  }
}

export async function getUserByUid(uid: string): Promise<AdminUserDTO | null> {
  try {
    const rows = await db.select().from(users).where(eq(users.uid, uid));
    if (!rows.length) return null;
    return mapUserToAdminDTO(rows[0]);
  } catch (error) {
    console.error('Database query failed in getUserByUid:', error);
    return null;
  }
}

export async function authenticateAdminByCredentials(
  identifier: string,
  plainPassword: string
): Promise<AdminUserDTO | null> {
  const cleanId = identifier.trim().toLowerCase();
  if (!cleanId || !plainPassword) return null;

  const allUsers = await db.select().from(users);
  const matched = allUsers.find(
    (u) =>
      u.email.toLowerCase() === cleanId ||
      (u.username && u.username.toLowerCase() === cleanId)
  );

  if (!matched) return null;
  if (matched.isActive === false) {
    throw new Error('Esta cuenta de administrador se encuentra suspendida.');
  }
  if (!matched.passwordHash || !verifyAdminPassword(plainPassword, matched.passwordHash)) {
    return null;
  }

  const updated = await db
    .update(users)
    .set({ lastLoginAt: new Date() })
    .where(eq(users.uid, matched.uid))
    .returning();

  return mapUserToAdminDTO(updated[0]);
}

export async function listAdminUsers(): Promise<AdminUserDTO[]> {
  try {
    const rows = await db.select().from(users).orderBy(asc(users.createdAt));
    return rows.map(mapUserToAdminDTO);
  } catch (error) {
    console.error('Database query failed in listAdminUsers:', error);
    throw new Error('No se pudo consultar el directorio de administradores.', { cause: error });
  }
}

export async function createAdminUserWithPassword(input: {
  displayName: string;
  username: string;
  email: string;
  password: string;
  role: AdminRole;
  createdBy: string;
}): Promise<AdminUserDTO> {
  const cleanUsername = input.username.trim().toLowerCase();
  const cleanEmail = input.email.trim().toLowerCase();
  const cleanName = input.displayName.trim();

  if (!cleanUsername || !cleanEmail || !cleanName) {
    throw new Error('Nombre, usuario y correo electrónico son obligatorios.');
  }
  if (input.password.length < 6) {
    throw new Error('La clave del administrador debe tener al menos 6 caracteres.');
  }

  const existing = await db.select().from(users);
  const duplicateUser = existing.find(
    (u) =>
      (u.username && u.username.toLowerCase() === cleanUsername) ||
      u.email.toLowerCase() === cleanEmail
  );
  if (duplicateUser) {
    throw new Error('Ya existe un administrador registrado con ese usuario o correo electrónico.');
  }

  const uid = `adm-${crypto.randomUUID().slice(0, 12)}`;
  const inserted = await db
    .insert(users)
    .values({
      uid,
      username: cleanUsername,
      email: cleanEmail,
      displayName: cleanName,
      role: input.role,
      passwordHash: hashAdminPassword(input.password),
      isActive: true,
      createdBy: input.createdBy,
    })
    .returning();

  return mapUserToAdminDTO(inserted[0]);
}

export async function updateAdminPassword(
  targetUid: string,
  newPassword: string
): Promise<AdminUserDTO> {
  if (!newPassword || newPassword.length < 6) {
    throw new Error('La nueva clave debe contener al menos 6 caracteres.');
  }

  const updated = await db
    .update(users)
    .set({
      passwordHash: hashAdminPassword(newPassword),
    })
    .where(eq(users.uid, targetUid))
    .returning();

  if (!updated.length) {
    throw new Error('Administrador no encontrado.');
  }
  return mapUserToAdminDTO(updated[0]);
}

export async function updateAdminAccount(
  targetUid: string,
  patch: {
    isActive?: boolean;
    role?: AdminRole;
    displayName?: string;
    username?: string;
  }
): Promise<AdminUserDTO> {
  const updateValues: Record<string, unknown> = {};
  if (patch.isActive !== undefined) updateValues.isActive = Boolean(patch.isActive);
  if (patch.role !== undefined) updateValues.role = patch.role;
  if (patch.displayName !== undefined) updateValues.displayName = patch.displayName.trim();
  if (patch.username !== undefined) updateValues.username = patch.username.trim().toLowerCase();

  const updated = await db
    .update(users)
    .set(updateValues)
    .where(eq(users.uid, targetUid))
    .returning();

  if (!updated.length) {
    throw new Error('Administrador no encontrado.');
  }
  return mapUserToAdminDTO(updated[0]);
}

export async function deleteAdminUser(targetUid: string): Promise<{ deleted: boolean }> {
  if (targetUid === DEFAULT_MASTER_ADMIN_UID) {
    throw new Error('La cuenta del Administrador Principal del sistema no puede eliminarse.');
  }

  await db
    .update(leads)
    .set({ assignedAdvisorUid: null })
    .where(eq(leads.assignedAdvisorUid, targetUid));

  await db
    .update(leadActivities)
    .set({ advisorUid: null })
    .where(eq(leadActivities.advisorUid, targetUid));

  await db.delete(users).where(eq(users.uid, targetUid));
  return { deleted: true };
}

export async function listAllLeadsWithDetails() {
  try {
    // Orden principal por fecha y hora exacta de registro (más recientes primero)
    const allLeads = await db
      .select()
      .from(leads)
      .orderBy(desc(leads.createdAt), desc(leads.id));

    const allVehicles = await db.select().from(vehicleRequests);
    const allProperties = await db.select().from(propertyRequests);
    const allActivities = await db
      .select()
      .from(leadActivities)
      .orderBy(desc(leadActivities.createdAt));
    const allAttachments = await db
      .select()
      .from(leadAttachments)
      .orderBy(desc(leadAttachments.createdAt));

    const vehicleByLead = new Map<number, (typeof allVehicles)[number]>();
    for (const v of allVehicles) {
      if (!vehicleByLead.has(v.leadId)) vehicleByLead.set(v.leadId, v);
    }

    const propertyByLead = new Map<number, (typeof allProperties)[number]>();
    for (const p of allProperties) {
      if (!propertyByLead.has(p.leadId)) propertyByLead.set(p.leadId, p);
    }

    const activitiesByLead = new Map<number, (typeof allActivities)>();
    for (const act of allActivities) {
      const list = activitiesByLead.get(act.leadId) || [];
      list.push(act);
      activitiesByLead.set(act.leadId, list);
    }

    const attachmentsByLead = new Map<number, (typeof allAttachments)>();
    for (const att of allAttachments) {
      const list = attachmentsByLead.get(att.leadId) || [];
      list.push(att);
      attachmentsByLead.set(att.leadId, list);
    }

    return allLeads.map((lead) => ({
      ...lead,
      vehicleRequest: vehicleByLead.get(lead.id) || null,
      propertyRequest: propertyByLead.get(lead.id) || null,
      activities: activitiesByLead.get(lead.id) || [],
      attachments: attachmentsByLead.get(lead.id) || [],
    }));
  } catch (error) {
    console.error('Database query failed in listAllLeadsWithDetails:', error);
    throw new Error('Error al consultar la cartera de clientes en Cloud SQL.', {
      cause: error,
    });
  }
}

export async function getLeadByIdWithDetails(leadId: number) {
  try {
    const found = await db.select().from(leads).where(eq(leads.id, leadId));
    if (!found.length) return null;

    const lead = found[0];
    const vehicles = await db
      .select()
      .from(vehicleRequests)
      .where(eq(vehicleRequests.leadId, leadId));
    const properties = await db
      .select()
      .from(propertyRequests)
      .where(eq(propertyRequests.leadId, leadId));
    const activities = await db
      .select()
      .from(leadActivities)
      .where(eq(leadActivities.leadId, leadId))
      .orderBy(desc(leadActivities.createdAt));
    const attachments = await db
      .select()
      .from(leadAttachments)
      .where(eq(leadAttachments.leadId, leadId))
      .orderBy(desc(leadAttachments.createdAt));

    return {
      ...lead,
      vehicleRequest: vehicles[0] || null,
      propertyRequest: properties[0] || null,
      activities,
      attachments,
    };
  } catch (error) {
    console.error('Database query failed in getLeadByIdWithDetails:', error);
    throw new Error('Error al obtener el expediente del cliente.', { cause: error });
  }
}

export class DuplicateClientError extends Error {
  public readonly field: 'cedula' | 'phone' | 'email';

  constructor(field: 'cedula' | 'phone' | 'email', message: string) {
    super(message);
    this.name = 'DuplicateClientError';
    this.field = field;
  }
}

function extractCedulaKeys(raw: string): string[] {
  const keys = new Set<string>();
  const alnum = raw.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  if (alnum) {
    keys.add(`id:${alnum}`);
  }
  const digitsOnly = raw.replace(/\D/g, '');
  if (digitsOnly.length >= 5) {
    keys.add(`num:${digitsOnly}`);
  }
  return Array.from(keys);
}

function extractPhoneKeys(raw: string): string[] {
  const keys = new Set<string>();
  const digits = raw.replace(/\D/g, '');
  if (!digits) return [];

  keys.add(`raw:${digits}`);

  // Equivalencia automática Venezuela: 0412... <-> 58412... <-> 412...
  if (digits.startsWith('0') && digits.length === 11) {
    const sub = digits.slice(1);
    keys.add(`ve:${sub}`);
    keys.add(`raw:58${sub}`);
  } else if (digits.startsWith('58') && digits.length === 12) {
    const sub = digits.slice(2);
    keys.add(`ve:${sub}`);
    keys.add(`raw:0${sub}`);
  } else if (digits.length === 10 && digits.startsWith('4')) {
    keys.add(`ve:${digits}`);
    keys.add(`raw:58${digits}`);
    keys.add(`raw:0${digits}`);
  }

  return Array.from(keys);
}

function normalizeEmailKey(raw: string): string {
  return raw.trim().toLowerCase();
}

async function assertUniqueClientIdentifiers(params: {
  cedula?: string;
  phone?: string;
  email?: string;
  excludeLeadId?: number;
  isPublicContext: boolean;
}): Promise<void> {
  const existingRows = await db.select().from(leads);

  const inputCedulaKeys = params.cedula ? extractCedulaKeys(params.cedula) : [];
  const inputPhoneKeys = params.phone ? extractPhoneKeys(params.phone) : [];
  const inputEmailKey = params.email ? normalizeEmailKey(params.email) : '';

  for (const row of existingRows) {
    if (params.excludeLeadId !== undefined && row.id === params.excludeLeadId) {
      continue;
    }

    if (inputCedulaKeys.length > 0) {
      const existingCedulaKeys = extractCedulaKeys(row.cedula);
      if (inputCedulaKeys.some((k) => existingCedulaKeys.includes(k))) {
        throw new DuplicateClientError(
          'cedula',
          params.isPublicContext
            ? 'No se permiten registros duplicados: ya existe una solicitud registrada con esta Cédula de Identidad.'
            : `No se permiten clientes duplicados: la cédula ingresada ya pertenece al Expediente #${row.id} (${row.firstName} ${row.lastName}).`
        );
      }
    }

    if (inputPhoneKeys.length > 0) {
      const existingPhoneKeys = extractPhoneKeys(row.phone);
      if (inputPhoneKeys.some((k) => existingPhoneKeys.includes(k))) {
        throw new DuplicateClientError(
          'phone',
          params.isPublicContext
            ? 'No se permiten registros duplicados: ya existe una solicitud registrada con este número de teléfono.'
            : `No se permiten clientes duplicados: el teléfono ingresado ya pertenece al Expediente #${row.id} (${row.firstName} ${row.lastName}).`
        );
      }
    }

    if (inputEmailKey) {
      const existingEmailKey = normalizeEmailKey(row.email);
      if (existingEmailKey && inputEmailKey === existingEmailKey) {
        throw new DuplicateClientError(
          'email',
          params.isPublicContext
            ? 'No se permiten registros duplicados: ya existe una solicitud registrada con este correo electrónico.'
            : `No se permiten clientes duplicados: el correo electrónico ingresado ya pertenece al Expediente #${row.id} (${row.firstName} ${row.lastName}).`
        );
      }
    }
  }
}

export async function createLeadRecord(payload: CreatePublicLeadPayload) {
  try {
    const cleanCedula = payload.cedula.trim();
    const cleanPhone = payload.phone.trim();
    const cleanEmail = payload.email.trim().toLowerCase();
    const sourceLabel = payload.source || 'Formulario Web';

    await assertUniqueClientIdentifiers({
      cedula: cleanCedula,
      phone: cleanPhone,
      email: cleanEmail,
      isPublicContext: sourceLabel === 'Formulario Web',
    });

    const insertedLeads = await db
      .insert(leads)
      .values({
        firstName: payload.firstName.trim(),
        lastName: payload.lastName.trim(),
        cedula: cleanCedula,
        phone: cleanPhone,
        email: cleanEmail,
        city: payload.city.trim(),
        availableAmount: String(payload.availableAmount),
        interestType: payload.interestType,
        status: 'Nuevo',
        source: sourceLabel,
        nextCallAt: new Date(Date.now() + 2 * 60 * 60 * 1000), // Seguimiento inicial sugerido en +2 horas
      })
      .returning();

    const createdLead = insertedLeads[0];

    const isMotorized = payload.interestType === 'vehiculo' || payload.interestType === 'moto';

    if (isMotorized && payload.vehicle) {
      await db.insert(vehicleRequests).values({
        leadId: createdLead.id,
        condition: payload.vehicle.condition,
        year: payload.vehicle.year,
        brand: payload.vehicle.brand.trim(),
        model: payload.vehicle.model.trim(),
        estimatedTotalAmount: payload.vehicle.estimatedTotalAmount
          ? String(payload.vehicle.estimatedTotalAmount)
          : null,
      });
    } else if (payload.interestType === 'inmueble' && payload.property) {
      await db.insert(propertyRequests).values({
        leadId: createdLead.id,
        propertySeenConfirmed: Boolean(payload.property.propertySeenConfirmed),
        propertyCategory: payload.property.propertyCategory || 'Vivienda / Comercial',
        estimatedPropertyAmount: payload.property.estimatedPropertyAmount
          ? String(payload.property.estimatedPropertyAmount)
          : null,
        locationNotes: payload.property.locationNotes || null,
      });
    }

    const motorizedLabel = payload.interestType === 'moto' ? 'moto' : 'vehículo';

    await db.insert(leadActivities).values({
      leadId: createdLead.id,
      advisorName: 'Sistema de Captación Web',
      activityType: 'nota',
      title: 'Solicitud recibida desde Portal Público',
      description:
        isMotorized && payload.vehicle
          ? `Interés en ${motorizedLabel} ${payload.vehicle.condition}: ${payload.vehicle.brand} ${payload.vehicle.model} (${payload.vehicle.year}). Monto disponible: $${payload.availableAmount.toLocaleString('en-US')}.`
          : `Interés en financiamiento inmobiliario. Confirmó propiedad vista y monto conocido. Capital disponible: $${payload.availableAmount.toLocaleString('en-US')}.`,
      completed: true,
    });

    return await getLeadByIdWithDetails(createdLead.id);
  } catch (error) {
    if (error instanceof DuplicateClientError) {
      throw error;
    }
    console.error('Database query failed in createLeadRecord:', error);
    throw new Error('No se pudo registrar la solicitud en la base de datos.', { cause: error });
  }
}

export async function updateLeadFields(
  leadId: number,
  updates: {
    firstName?: string;
    lastName?: string;
    cedula?: string;
    phone?: string;
    email?: string;
    city?: string;
    status?: LeadStatus;
    nextCallAt?: string | null;
    availableAmount?: number;
    assignedAdvisorUid?: string | null;
    estimatedTotalAmount?: number;
    selectedPlan?: string;
  }
) {
  try {
    if (
      (updates.cedula !== undefined && updates.cedula.trim()) ||
      (updates.phone !== undefined && updates.phone.trim()) ||
      (updates.email !== undefined && updates.email.trim())
    ) {
      await assertUniqueClientIdentifiers({
        cedula: updates.cedula?.trim(),
        phone: updates.phone?.trim(),
        email: updates.email?.trim(),
        excludeLeadId: leadId,
        isPublicContext: false,
      });
    }

    const leadPatch: Record<string, unknown> = {
      updatedAt: new Date(),
    };
    if (updates.firstName !== undefined && updates.firstName.trim()) {
      leadPatch.firstName = updates.firstName.trim();
    }
    if (updates.lastName !== undefined && updates.lastName.trim()) {
      leadPatch.lastName = updates.lastName.trim();
    }
    if (updates.cedula !== undefined && updates.cedula.trim()) {
      leadPatch.cedula = updates.cedula.trim();
    }
    if (updates.phone !== undefined && updates.phone.trim()) {
      leadPatch.phone = updates.phone.trim();
    }
    if (updates.email !== undefined && updates.email.trim()) {
      leadPatch.email = updates.email.trim().toLowerCase();
    }
    if (updates.city !== undefined && updates.city.trim()) {
      leadPatch.city = updates.city.trim();
    }
    if (updates.status !== undefined) leadPatch.status = updates.status;
    if (updates.nextCallAt !== undefined) {
      leadPatch.nextCallAt = updates.nextCallAt ? new Date(updates.nextCallAt) : null;
    }
    if (updates.availableAmount !== undefined && Number.isFinite(Number(updates.availableAmount))) {
      leadPatch.availableAmount = String(updates.availableAmount);
    }
    if (updates.assignedAdvisorUid !== undefined) {
      leadPatch.assignedAdvisorUid = updates.assignedAdvisorUid;
    }

    await db.update(leads).set(leadPatch).where(eq(leads.id, leadId));

    if (updates.estimatedTotalAmount !== undefined || updates.selectedPlan !== undefined) {
      const existingVehicles = await db
        .select()
        .from(vehicleRequests)
        .where(eq(vehicleRequests.leadId, leadId));

      if (existingVehicles.length > 0) {
        const vPatch: Record<string, unknown> = {};
        if (updates.estimatedTotalAmount !== undefined) {
          vPatch.estimatedTotalAmount = String(updates.estimatedTotalAmount);
        }
        if (updates.selectedPlan !== undefined) {
          vPatch.selectedPlan = updates.selectedPlan;
        }
        await db
          .update(vehicleRequests)
          .set(vPatch)
          .where(eq(vehicleRequests.id, existingVehicles[0].id));
      } else {
        const existingProps = await db
          .select()
          .from(propertyRequests)
          .where(eq(propertyRequests.leadId, leadId));
        if (existingProps.length > 0 && updates.estimatedTotalAmount !== undefined) {
          await db
            .update(propertyRequests)
            .set({ estimatedPropertyAmount: String(updates.estimatedTotalAmount) })
            .where(eq(propertyRequests.id, existingProps[0].id));
        }
      }
    }

    return await getLeadByIdWithDetails(leadId);
  } catch (error) {
    if (error instanceof DuplicateClientError) {
      throw error;
    }
    console.error('Database query failed in updateLeadFields:', error);
    throw new Error('No se pudieron actualizar los datos del cliente.', { cause: error });
  }
}

export async function deleteLeadById(leadId: number): Promise<{
  deleted: boolean;
  id: number;
  clientName: string;
}> {
  try {
    const existing = await db.select().from(leads).where(eq(leads.id, leadId));
    if (!existing.length) {
      throw new Error('El cliente indicado ya no existe en la base de datos.');
    }

    const clientName = `${existing[0].firstName} ${existing[0].lastName}`.trim();

    // Eliminación explícita de registros dependientes y expediente principal
    await db.delete(leadAttachments).where(eq(leadAttachments.leadId, leadId));
    await db.delete(leadActivities).where(eq(leadActivities.leadId, leadId));
    await db.delete(vehicleRequests).where(eq(vehicleRequests.leadId, leadId));
    await db.delete(propertyRequests).where(eq(propertyRequests.leadId, leadId));
    await db.delete(leads).where(eq(leads.id, leadId));

    return {
      deleted: true,
      id: leadId,
      clientName,
    };
  } catch (error) {
    console.error('Database query failed in deleteLeadById:', error);
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('No se pudo eliminar el cliente de la base de datos.', { cause: error });
  }
}

export async function addLeadActivity(input: {
  leadId: number;
  advisorUid?: string | null;
  advisorName?: string | null;
  activityType: string;
  title: string;
  description: string;
  scheduledAt?: string | null;
  reminderEnabled?: boolean;
  completed?: boolean;
}) {
  try {
    const scheduledDate = input.scheduledAt ? new Date(input.scheduledAt) : null;

    const inserted = await db
      .insert(leadActivities)
      .values({
        leadId: input.leadId,
        advisorUid: input.advisorUid || null,
        advisorName: input.advisorName || 'Asesor Autofin',
        activityType: input.activityType,
        title: input.title.trim(),
        description: input.description.trim(),
        scheduledAt: scheduledDate,
        reminderEnabled: Boolean(input.reminderEnabled),
        completed: Boolean(input.completed),
      })
      .returning();

    // Si es una llamada agendada futura, sincronizar nextCallAt del lead automáticamente
    if (input.activityType === 'llamada' && scheduledDate && !input.completed) {
      await db
        .update(leads)
        .set({ nextCallAt: scheduledDate, updatedAt: new Date() })
        .where(eq(leads.id, input.leadId));
    }

    if (input.activityType === 'cita_presencial' && !input.completed) {
      await db
        .update(leads)
        .set({ status: 'Cita Presencial', updatedAt: new Date() })
        .where(eq(leads.id, input.leadId));
    }

    return inserted[0];
  } catch (error) {
    console.error('Database query failed in addLeadActivity:', error);
    throw new Error('No se pudo registrar la actividad en el historial.', { cause: error });
  }
}

export async function toggleActivityCompleted(activityId: number, completed: boolean) {
  try {
    const updated = await db
      .update(leadActivities)
      .set({ completed })
      .where(eq(leadActivities.id, activityId))
      .returning();
    return updated[0] || null;
  } catch (error) {
    console.error('Database query failed in toggleActivityCompleted:', error);
    throw new Error('No se pudo actualizar el estado de la actividad.', { cause: error });
  }
}

export async function addLeadAttachment(input: {
  leadId: number;
  fileName: string;
  mimeType: string;
  fileSize: number;
  dataUrl: string;
  caption?: string;
  uploadedBy?: string;
}) {
  try {
    const inserted = await db
      .insert(leadAttachments)
      .values({
        leadId: input.leadId,
        fileName: input.fileName,
        mimeType: input.mimeType,
        fileSize: input.fileSize,
        dataUrl: input.dataUrl,
        caption: input.caption || null,
        uploadedBy: input.uploadedBy || 'Asesor Autofin',
      })
      .returning();
    return inserted[0];
  } catch (error) {
    console.error('Database query failed in addLeadAttachment:', error);
    throw new Error('No se pudo adjuntar el archivo en la ficha del cliente.', { cause: error });
  }
}

export async function deleteLeadAttachment(attachmentId: number) {
  try {
    await db.delete(leadAttachments).where(eq(leadAttachments.id, attachmentId));
    return { deleted: true };
  } catch (error) {
    console.error('Database query failed in deleteLeadAttachment:', error);
    throw new Error('No se pudo eliminar el archivo adjunto.', { cause: error });
  }
}

export async function getCalculatorSettings(): Promise<CalculatorSettingsDTO> {
  try {
    const rows = await db
      .select()
      .from(calculatorSettings)
      .orderBy(desc(calculatorSettings.id));

    if (!rows.length) {
      return DEFAULT_CALCULATOR_SETTINGS;
    }

    const r = rows[0];
    return {
      id: r.id,
      defaultAssetAmount: Number(r.defaultAssetAmount || 25080),
      baseInstallments: r.baseInstallments,
      adminFee: Number(r.adminFee),
      planGarantizado1Months: r.planGarantizado1Months,
      planGarantizado2Months: r.planGarantizado2Months,
      planPromoMonths: r.planPromoMonths,
      planAhorroMonths: r.planAhorroMonths,
      fastDelivery1Pct: Number(r.fastDelivery1Pct),
      fastDelivery2Pct: Number(r.fastDelivery2Pct),
      promo4Plus8Pct: Number(r.promo4Plus8Pct),
      ahorroFastPct: Number(r.ahorroFastPct),
    };
  } catch (error) {
    console.error('Database query failed in getCalculatorSettings:', error);
    throw new Error('Error al leer la configuración de planes.', { cause: error });
  }
}

export async function saveCalculatorSettings(
  input: CalculatorSettingsDTO
): Promise<CalculatorSettingsDTO> {
  try {
    const existing = await db
      .select()
      .from(calculatorSettings)
      .orderBy(desc(calculatorSettings.id));

    const values = {
      defaultAssetAmount: String(
        Number.isFinite(Number(input.defaultAssetAmount)) && Number(input.defaultAssetAmount) > 0
          ? Number(input.defaultAssetAmount)
          : 25080
      ),
      baseInstallments: Math.max(1, Math.round(input.baseInstallments)),
      adminFee: String(input.adminFee),
      planGarantizado1Months: Math.max(1, Math.round(input.planGarantizado1Months)),
      planGarantizado2Months: Math.max(1, Math.round(input.planGarantizado2Months)),
      planPromoMonths: Math.max(1, Math.round(input.planPromoMonths)),
      planAhorroMonths: Math.max(1, Math.round(input.planAhorroMonths)),
      fastDelivery1Pct: String(input.fastDelivery1Pct),
      fastDelivery2Pct: String(input.fastDelivery2Pct),
      promo4Plus8Pct: String(input.promo4Plus8Pct),
      ahorroFastPct: String(input.ahorroFastPct),
      updatedAt: new Date(),
    };

    if (existing.length > 0) {
      await db
        .update(calculatorSettings)
        .set(values)
        .where(eq(calculatorSettings.id, existing[0].id));
    } else {
      await db.insert(calculatorSettings).values(values);
    }

    return await getCalculatorSettings();
  } catch (error) {
    console.error('Database query failed in saveCalculatorSettings:', error);
    throw new Error('No se pudo guardar la configuración de la calculadora.', { cause: error });
  }
}

export interface RawEmailConfig {
  enabled: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPass: string;
  senderName: string;
  replyToEmail: string;
  advisorNotifyEmail: string;
  sendCopyToAdvisor: boolean;
}

export async function getEmailSettingsRaw(): Promise<RawEmailConfig> {
  try {
    const rows = await db
      .select()
      .from(emailSettings)
      .orderBy(desc(emailSettings.id));

    const envHost = process.env.SMTP_HOST?.trim() || 'smtp.gmail.com';
    const envPort = Number(process.env.SMTP_PORT) || 465;
    const envSecure = process.env.SMTP_SECURE ? process.env.SMTP_SECURE !== 'false' : envPort === 465;
    const envUser = process.env.SMTP_USER?.trim() || '';
    const envPass = process.env.SMTP_PASS?.trim() || '';
    const envSender =
      process.env.SMTP_SENDER_NAME?.trim() || 'Autofin Venezuela · Jesús Artahona';

    if (!rows.length) {
      return {
        enabled: true,
        smtpHost: envHost,
        smtpPort: envPort,
        smtpSecure: envSecure,
        smtpUser: envUser,
        smtpPass: envPass,
        senderName: envSender,
        replyToEmail: envUser,
        advisorNotifyEmail: '',
        sendCopyToAdvisor: true,
      };
    }

    const r = rows[0];
    return {
      enabled: r.enabled !== false,
      smtpHost: r.smtpHost?.trim() || envHost,
      smtpPort: r.smtpPort || envPort,
      smtpSecure: Boolean(r.smtpSecure),
      smtpUser: r.smtpUser?.trim() || envUser,
      smtpPass: r.smtpPass?.trim() || envPass,
      senderName: r.senderName?.trim() || envSender,
      replyToEmail: r.replyToEmail?.trim() || r.smtpUser?.trim() || envUser,
      advisorNotifyEmail: r.advisorNotifyEmail?.trim() || '',
      sendCopyToAdvisor: r.sendCopyToAdvisor !== false,
    };
  } catch (error) {
    console.error('Database query failed in getEmailSettingsRaw:', error);
    return {
      enabled: true,
      smtpHost: 'smtp.gmail.com',
      smtpPort: 465,
      smtpSecure: true,
      smtpUser: process.env.SMTP_USER?.trim() || '',
      smtpPass: process.env.SMTP_PASS?.trim() || '',
      senderName: 'Autofin Venezuela · Jesús Artahona',
      replyToEmail: '',
      advisorNotifyEmail: '',
      sendCopyToAdvisor: true,
    };
  }
}

export async function getEmailSettingsForAdmin(): Promise<EmailSettingsDTO> {
  const raw = await getEmailSettingsRaw();
  return {
    enabled: raw.enabled,
    smtpHost: raw.smtpHost,
    smtpPort: raw.smtpPort,
    smtpSecure: raw.smtpSecure,
    smtpUser: raw.smtpUser,
    hasSmtpPass: Boolean(raw.smtpPass),
    senderName: raw.senderName,
    replyToEmail: raw.replyToEmail,
    advisorNotifyEmail: raw.advisorNotifyEmail,
    sendCopyToAdvisor: raw.sendCopyToAdvisor,
    configuredReady: Boolean(raw.enabled && raw.smtpHost && raw.smtpUser && raw.smtpPass),
  };
}

export async function saveEmailSettings(
  input: EmailSettingsUpdatePayload
): Promise<EmailSettingsDTO> {
  try {
    const existing = await db
      .select()
      .from(emailSettings)
      .orderBy(desc(emailSettings.id));

    const current = await getEmailSettingsRaw();
    const nextPort = Number(input.smtpPort) || current.smtpPort || 465;

    const values = {
      enabled: input.enabled !== undefined ? Boolean(input.enabled) : current.enabled,
      smtpHost: input.smtpHost !== undefined ? input.smtpHost.trim() || 'smtp.gmail.com' : current.smtpHost,
      smtpPort: nextPort,
      smtpSecure: input.smtpSecure !== undefined ? Boolean(input.smtpSecure) : nextPort === 465,
      smtpUser: input.smtpUser !== undefined ? input.smtpUser.trim() : current.smtpUser,
      smtpPass:
        input.smtpPass !== undefined && input.smtpPass.trim().length > 0
          ? input.smtpPass.trim()
          : existing[0]?.smtpPass || current.smtpPass || null,
      senderName:
        input.senderName !== undefined
          ? input.senderName.trim() || 'Autofin Venezuela · Jesús Artahona'
          : current.senderName,
      replyToEmail:
        input.replyToEmail !== undefined ? input.replyToEmail.trim() : current.replyToEmail,
      advisorNotifyEmail:
        input.advisorNotifyEmail !== undefined
          ? input.advisorNotifyEmail.trim()
          : current.advisorNotifyEmail,
      sendCopyToAdvisor:
        input.sendCopyToAdvisor !== undefined
          ? Boolean(input.sendCopyToAdvisor)
          : current.sendCopyToAdvisor,
      updatedAt: new Date(),
    };

    if (existing.length > 0) {
      await db
        .update(emailSettings)
        .set(values)
        .where(eq(emailSettings.id, existing[0].id));
    } else {
      await db.insert(emailSettings).values(values);
    }

    return await getEmailSettingsForAdmin();
  } catch (error) {
    console.error('Database query failed in saveEmailSettings:', error);
    throw new Error('No se pudo guardar la configuración de correo electrónico.', {
      cause: error,
    });
  }
}
