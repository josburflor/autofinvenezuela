import type { User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import { DEFAULT_CALCULATOR_SETTINGS } from '../shared/calculator';
import {
  DEFAULT_ADVISOR_PHOTO_URL,
  OFFICIAL_OFFICE_ADDRESS,
  type ActivityType,
  type AdminRole,
  type AdminUserDTO,
  type AdvisorProfileDTO,
  type CalculatorSettingsDTO,
  type CreatePublicLeadPayload,
  type InterestType,
  type LeadActivityDTO,
  type LeadAttachmentDTO,
  type LeadRecordDTO,
  type LeadStatus,
} from '../shared/types';
import { auth, db, handleFirestoreError, OperationType } from './firebase';

export const BOOTSTRAPPED_ADMIN_EMAIL = 'josburflor@gmail.com';

// Verbatim structural boundaries synchronized with firebase-blueprint.json & firestore.rules
export const BLUEPRINT_LIMITS = {
  ID_MAX: 128,
  ID_PATTERN: /^[a-zA-Z0-9_\-]+$/,
  EMAIL_MAX: 160,
  EMAIL_PATTERN: /^[^@\s]+@[^@\s]+\.[^@\s]+$/,
  NAME_MAX: 80,
  DISPLAY_NAME_MAX: 120,
  CEDULA_MAX: 24,
  PHONE_MAX: 24,
  CITY_MAX: 80,
  BRAND_MAX: 80,
  MODEL_MAX: 100,
  PLAN_MAX: 120,
  NOTES_MAX: 500,
  ACTIVITY_TITLE_MAX: 160,
  ACTIVITY_DESC_MAX: 2000,
  ATTACHMENT_FILENAME_MAX: 180,
  ATTACHMENT_CAPTION_MAX: 300,
  ATTACHMENT_MAX_BYTES: 700000,
  ATTACHMENT_DATAURL_MAX: 950000,
  ADVISOR_PHOTO_DATAURL_MAX: 300000,
  PORTAL_ASSET_DATAURL_MAX: 900000,
} as const;

export const INITIAL_FIRESTORE_ADVISOR_PROFILE: AdvisorProfileDTO = {
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

function sanitizeBoundedString(raw: string | undefined | null, maxLength: number, fallback = ''): string {
  const cleaned = (raw ?? fallback).trim();
  if (!cleaned) return fallback.slice(0, maxLength);
  return cleaned.slice(0, maxLength);
}

function deterministicShortHash(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function buildCedulaLockId(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length >= 5) {
    return `ced_${digits.slice(0, 48)}`;
  }
  const alnum = raw.replace(/[^a-zA-Z0-9]/g, '').toUpperCase() || 'UNKNOWN';
  return `ced_${alnum.slice(0, 48)}`;
}

export function buildPhoneLockId(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  let normalized = digits || '000000';
  if (digits.startsWith('0') && digits.length === 11) {
    normalized = `58${digits.slice(1)}`;
  } else if (digits.length === 10 && digits.startsWith('4')) {
    normalized = `58${digits}`;
  }
  return `tel_${normalized.slice(0, 48)}`;
}

export function buildEmailLockId(raw: string): string {
  const lower = raw.trim().toLowerCase();
  const slug = lower
    .replace(/@/g, '_at_')
    .replace(/\./g, '_dot_')
    .replace(/[^a-z0-9_\-]/g, '_')
    .slice(0, 96);
  const hash = deterministicShortHash(lower);
  return `eml_${slug}_${hash}`.slice(0, 124);
}

function timestampToIso(val: unknown, fallbackIso?: string): string {
  if (val instanceof Timestamp) {
    return val.toDate().toISOString();
  }
  if (val && typeof val === 'object' && 'toDate' in val && typeof (val as { toDate: () => Date }).toDate === 'function') {
    return (val as { toDate: () => Date }).toDate().toISOString();
  }
  if (typeof fallbackIso === 'string' && fallbackIso.length >= 10) {
    return fallbackIso;
  }
  return new Date().toISOString();
}

function generateNumericId(): number {
  const nowSec = Math.floor(Date.now() / 1000) - 1_700_000_000;
  const rand = Math.floor(Math.random() * 900) + 100;
  return Math.max(1, nowSec * 1000 + rand);
}

export function isDuplicatePermissionError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes('Missing or insufficient permissions') ||
    msg.includes('permission-denied') ||
    msg.includes('PERMISSION_DENIED')
  );
}

// ============================================================================
// 1. PORTAL PROFILE & HERO ASSETS (/advisorProfiles/main & /portalAssets/*)
// ============================================================================
export async function fetchFirestoreAdvisorProfile(): Promise<AdvisorProfileDTO | null> {
  const profilePath = 'advisorProfiles/main';
  let profileSnap;
  try {
    profileSnap = await getDoc(doc(db, 'advisorProfiles', 'main'));
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, profilePath);
  }

  const assetKeys = ['vehiculo', 'moto', 'inmueble'] as const;
  const assetUrls: Record<(typeof assetKeys)[number], string | null> = {
    vehiculo: null,
    moto: null,
    inmueble: null,
  };

  await Promise.all(
    assetKeys.map(async (key) => {
      const assetPath = `portalAssets/${key}`;
      try {
        const snap = await getDoc(doc(db, 'portalAssets', key));
        if (snap.exists()) {
          const data = snap.data();
          assetUrls[key] = typeof data.dataUrl === 'string' && data.dataUrl.length > 0 ? data.dataUrl : null;
        }
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, assetPath);
      }
    })
  );

  if (!profileSnap.exists() && !assetUrls.vehiculo && !assetUrls.moto && !assetUrls.inmueble) {
    return null;
  }

  const d = profileSnap.exists() ? profileSnap.data() : {};
  return {
    advisorName:
      typeof d.advisorName === 'string' && d.advisorName.trim()
        ? d.advisorName
        : INITIAL_FIRESTORE_ADVISOR_PROFILE.advisorName,
    advisorTitle:
      typeof d.advisorTitle === 'string' && d.advisorTitle.trim()
        ? d.advisorTitle
        : INITIAL_FIRESTORE_ADVISOR_PROFILE.advisorTitle,
    photoUrl:
      typeof d.photoUrl === 'string' && d.photoUrl.trim()
        ? d.photoUrl
        : INITIAL_FIRESTORE_ADVISOR_PROFILE.photoUrl,
    welcomeBio:
      typeof d.welcomeBio === 'string' && d.welcomeBio.trim()
        ? d.welcomeBio
        : INITIAL_FIRESTORE_ADVISOR_PROFILE.welcomeBio,
    officeAddress:
      typeof d.officeAddress === 'string' && d.officeAddress.trim()
        ? d.officeAddress
        : OFFICIAL_OFFICE_ADDRESS,
    heroTitle:
      typeof d.heroTitle === 'string' && d.heroTitle.trim()
        ? d.heroTitle
        : INITIAL_FIRESTORE_ADVISOR_PROFILE.heroTitle,
    heroSubtitle:
      typeof d.heroSubtitle === 'string' && d.heroSubtitle.trim()
        ? d.heroSubtitle
        : INITIAL_FIRESTORE_ADVISOR_PROFILE.heroSubtitle,
    heroVehiculoUrl: assetUrls.vehiculo,
    heroMotoUrl: assetUrls.moto,
    heroInmuebleUrl: assetUrls.inmueble,
    updatedAt: timestampToIso(d.updatedAt),
  };
}

export async function saveFirestoreAdvisorProfile(
  current: AdvisorProfileDTO,
  patch: Partial<AdvisorProfileDTO>
): Promise<AdvisorProfileDTO> {
  const uid = auth.currentUser?.uid;
  if (!uid) {
    throw new Error('Inicie sesión con su cuenta autorizada de Firebase para guardar cambios en la nube.');
  }

  const merged: AdvisorProfileDTO = {
    advisorName: sanitizeBoundedString(
      patch.advisorName ?? current.advisorName,
      BLUEPRINT_LIMITS.DISPLAY_NAME_MAX,
      INITIAL_FIRESTORE_ADVISOR_PROFILE.advisorName
    ),
    advisorTitle: sanitizeBoundedString(
      patch.advisorTitle ?? current.advisorTitle,
      160,
      INITIAL_FIRESTORE_ADVISOR_PROFILE.advisorTitle
    ),
    photoUrl: sanitizeBoundedString(
      patch.photoUrl ?? current.photoUrl,
      BLUEPRINT_LIMITS.ADVISOR_PHOTO_DATAURL_MAX,
      DEFAULT_ADVISOR_PHOTO_URL
    ),
    welcomeBio: sanitizeBoundedString(
      patch.welcomeBio ?? current.welcomeBio,
      600,
      INITIAL_FIRESTORE_ADVISOR_PROFILE.welcomeBio
    ),
    officeAddress: sanitizeBoundedString(
      patch.officeAddress ?? current.officeAddress,
      200,
      OFFICIAL_OFFICE_ADDRESS
    ),
    heroTitle: sanitizeBoundedString(
      patch.heroTitle ?? current.heroTitle,
      180,
      INITIAL_FIRESTORE_ADVISOR_PROFILE.heroTitle
    ),
    heroSubtitle: sanitizeBoundedString(
      patch.heroSubtitle ?? current.heroSubtitle,
      160,
      INITIAL_FIRESTORE_ADVISOR_PROFILE.heroSubtitle
    ),
    heroVehiculoUrl:
      patch.heroVehiculoUrl !== undefined ? patch.heroVehiculoUrl : current.heroVehiculoUrl,
    heroMotoUrl: patch.heroMotoUrl !== undefined ? patch.heroMotoUrl : current.heroMotoUrl,
    heroInmuebleUrl:
      patch.heroInmuebleUrl !== undefined ? patch.heroInmuebleUrl : current.heroInmuebleUrl,
  };

  try {
    await setDoc(doc(db, 'advisorProfiles', 'main'), {
      advisorName: merged.advisorName,
      advisorTitle: merged.advisorTitle,
      photoUrl: merged.photoUrl,
      welcomeBio: merged.welcomeBio,
      officeAddress: merged.officeAddress,
      heroTitle: merged.heroTitle,
      heroSubtitle: merged.heroSubtitle,
      updatedByUid: uid,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'advisorProfiles/main');
  }

  const assetEntries: Array<['vehiculo' | 'moto' | 'inmueble', string | null | undefined]> = [
    ['vehiculo', merged.heroVehiculoUrl],
    ['moto', merged.heroMotoUrl],
    ['inmueble', merged.heroInmuebleUrl],
  ];

  for (const [assetKey, rawUrl] of assetEntries) {
    const cleanDataUrl = (rawUrl || '').trim().slice(0, BLUEPRINT_LIMITS.PORTAL_ASSET_DATAURL_MAX);
    try {
      await setDoc(doc(db, 'portalAssets', assetKey), {
        assetKey,
        dataUrl: cleanDataUrl,
        updatedByUid: uid,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `portalAssets/${assetKey}`);
    }
  }

  return {
    ...merged,
    updatedAt: new Date().toISOString(),
  };
}

// ============================================================================
// 2. CALCULATOR SETTINGS (/calculatorConfigs/main)
// ============================================================================
export async function fetchFirestoreCalculatorSettings(): Promise<CalculatorSettingsDTO | null> {
  const path = 'calculatorConfigs/main';
  try {
    const snap = await getDoc(doc(db, 'calculatorConfigs', 'main'));
    if (!snap.exists()) return null;
    const d = snap.data();
    return {
      defaultAssetAmount: Number(d.defaultAssetAmount) || DEFAULT_CALCULATOR_SETTINGS.defaultAssetAmount,
      baseInstallments: Number(d.baseInstallments) || DEFAULT_CALCULATOR_SETTINGS.baseInstallments,
      adminFee: Number(d.adminFee) ?? DEFAULT_CALCULATOR_SETTINGS.adminFee,
      planGarantizado1Months:
        Number(d.planGarantizado1Months) || DEFAULT_CALCULATOR_SETTINGS.planGarantizado1Months,
      planGarantizado2Months:
        Number(d.planGarantizado2Months) || DEFAULT_CALCULATOR_SETTINGS.planGarantizado2Months,
      planPromoMonths: Number(d.planPromoMonths) || DEFAULT_CALCULATOR_SETTINGS.planPromoMonths,
      planAhorroMonths: Number(d.planAhorroMonths) || DEFAULT_CALCULATOR_SETTINGS.planAhorroMonths,
      fastDelivery1Pct: Number(d.fastDelivery1Pct) ?? DEFAULT_CALCULATOR_SETTINGS.fastDelivery1Pct,
      fastDelivery2Pct: Number(d.fastDelivery2Pct) ?? DEFAULT_CALCULATOR_SETTINGS.fastDelivery2Pct,
      promo4Plus8Pct: Number(d.promo4Plus8Pct) ?? DEFAULT_CALCULATOR_SETTINGS.promo4Plus8Pct,
      ahorroFastPct: Number(d.ahorroFastPct) ?? DEFAULT_CALCULATOR_SETTINGS.ahorroFastPct,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function saveFirestoreCalculatorSettings(
  next: CalculatorSettingsDTO
): Promise<CalculatorSettingsDTO> {
  const uid = auth.currentUser?.uid;
  if (!uid) {
    throw new Error('Inicie sesión con su cuenta autorizada de Firebase para guardar la calculadora.');
  }

  const normalized: CalculatorSettingsDTO = {
    defaultAssetAmount: Math.min(100000000, Math.max(1, Number(next.defaultAssetAmount) || 25080)),
    baseInstallments: Math.min(360, Math.max(1, Math.round(Number(next.baseInstallments) || 60))),
    adminFee: Math.min(1000000, Math.max(0, Number(next.adminFee) || 0)),
    planGarantizado1Months: Math.min(360, Math.max(1, Math.round(Number(next.planGarantizado1Months) || 24))),
    planGarantizado2Months: Math.min(360, Math.max(1, Math.round(Number(next.planGarantizado2Months) || 17))),
    planPromoMonths: Math.min(360, Math.max(1, Math.round(Number(next.planPromoMonths) || 4))),
    planAhorroMonths: Math.min(360, Math.max(1, Math.round(Number(next.planAhorroMonths) || 1))),
    fastDelivery1Pct: Math.min(100, Math.max(0, Number(next.fastDelivery1Pct) || 0)),
    fastDelivery2Pct: Math.min(100, Math.max(0, Number(next.fastDelivery2Pct) || 0)),
    promo4Plus8Pct: Math.min(100, Math.max(0, Number(next.promo4Plus8Pct) || 0)),
    ahorroFastPct: Math.min(100, Math.max(0, Number(next.ahorroFastPct) || 0)),
  };

  try {
    await setDoc(doc(db, 'calculatorConfigs', 'main'), {
      ...normalized,
      updatedByUid: uid,
      updatedAt: serverTimestamp(),
    });
    return normalized;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'calculatorConfigs/main');
  }
}

// ============================================================================
// 3. ADMINISTRATORS & ADVISORS RBAC (/admins/{adminUid})
// ============================================================================
export async function ensureFirebaseAdminBootstrapped(fbUser: User): Promise<AdminUserDTO | null> {
  if (!fbUser.email || !fbUser.emailVerified) {
    return null;
  }

  const cleanEmail = fbUser.email.trim().toLowerCase();
  const adminPath = `admins/${fbUser.uid}`;

  let snap;
  try {
    snap = await getDoc(doc(db, 'admins', fbUser.uid));
  } catch (error) {
    // Non-registered user attempting getDoc on own uid is allowed by rules, so only unexpected errors throw
    handleFirestoreError(error, OperationType.GET, adminPath);
  }

  if (snap.exists()) {
    const d = snap.data();
    if (d.isActive === false) {
      throw new Error('Esta cuenta de administrador se encuentra suspendida.');
    }
    const role: AdminRole =
      d.role === 'super_admin' || d.role === 'admin' || d.role === 'asesor' ? d.role : 'admin';
    return {
      uid: fbUser.uid,
      username: cleanEmail.split('@')[0],
      email: d.email || cleanEmail,
      displayName: d.displayName || fbUser.displayName || 'Jesús Artahona',
      role,
      hasPassword: false,
      isActive: true,
      createdBy: d.createdByUid || 'Firebase Auth',
      lastLoginAt: new Date().toISOString(),
      createdAt: timestampToIso(d.createdAt),
    };
  }

  if (cleanEmail === BOOTSTRAPPED_ADMIN_EMAIL) {
    const displayName = sanitizeBoundedString(
      fbUser.displayName || 'Jesús Artahona',
      BLUEPRINT_LIMITS.DISPLAY_NAME_MAX,
      'Jesús Artahona'
    );
    try {
      await setDoc(doc(db, 'admins', fbUser.uid), {
        uid: fbUser.uid,
        email: cleanEmail,
        displayName,
        role: 'super_admin',
        isActive: true,
        createdByUid: fbUser.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, adminPath);
    }

    return {
      uid: fbUser.uid,
      username: 'admin',
      email: cleanEmail,
      displayName,
      role: 'super_admin',
      hasPassword: false,
      isActive: true,
      createdBy: 'Propietario Firebase',
      lastLoginAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
  }

  return null;
}

export async function listFirestoreAdmins(): Promise<AdminUserDTO[]> {
  const current = auth.currentUser;
  if (!current?.email) return [];

  const isBootstrapped = current.email.trim().toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL;
  const q = isBootstrapped
    ? query(collection(db, 'admins'), orderBy('createdAt', 'asc'))
    : query(collection(db, 'admins'), where('uid', '==', current.uid));

  try {
    const snap = await getDocs(q);
    return snap.docs.map((item) => {
      const d = item.data();
      const role: AdminRole =
        d.role === 'super_admin' || d.role === 'admin' || d.role === 'asesor' ? d.role : 'admin';
      return {
        uid: d.uid || item.id,
        username: typeof d.email === 'string' ? d.email.split('@')[0] : null,
        email: d.email || '',
        displayName: d.displayName || null,
        role,
        hasPassword: false,
        isActive: d.isActive !== false,
        createdBy: d.createdByUid || 'Firebase Cloud',
        lastLoginAt: timestampToIso(d.updatedAt),
        createdAt: timestampToIso(d.createdAt),
      };
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'admins');
  }
}

export async function createFirestoreAdminByUid(input: {
  targetUid: string;
  email: string;
  displayName: string;
  role: AdminRole;
}): Promise<AdminUserDTO> {
  const caller = auth.currentUser;
  if (!caller) {
    throw new Error('Se requiere sesión activa en Firebase.');
  }

  const cleanUid = input.targetUid.trim();
  if (!BLUEPRINT_LIMITS.ID_PATTERN.test(cleanUid) || cleanUid.length > BLUEPRINT_LIMITS.ID_MAX) {
    throw new Error('El UID de Firebase debe contener solo letras, números, guiones o guiones bajos.');
  }

  const cleanEmail = input.email.trim().toLowerCase().slice(0, BLUEPRINT_LIMITS.EMAIL_MAX);
  if (!BLUEPRINT_LIMITS.EMAIL_PATTERN.test(cleanEmail)) {
    throw new Error('Ingrese un correo electrónico válido.');
  }

  const cleanName = sanitizeBoundedString(
    input.displayName,
    BLUEPRINT_LIMITS.DISPLAY_NAME_MAX,
    'Asesor Autofin'
  );
  const path = `admins/${cleanUid}`;

  try {
    await setDoc(doc(db, 'admins', cleanUid), {
      uid: cleanUid,
      email: cleanEmail,
      displayName: cleanName,
      role: input.role,
      isActive: true,
      createdByUid: caller.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }

  const nowIso = new Date().toISOString();
  return {
    uid: cleanUid,
    username: cleanEmail.split('@')[0],
    email: cleanEmail,
    displayName: cleanName,
    role: input.role,
    hasPassword: false,
    isActive: true,
    createdBy: caller.uid,
    lastLoginAt: null,
    createdAt: nowIso,
  };
}

export async function updateFirestoreAdminAccount(
  targetUid: string,
  currentAdmin: AdminUserDTO,
  patch: { isActive?: boolean; role?: AdminRole; displayName?: string }
): Promise<void> {
  const path = `admins/${targetUid}`;
  const payload: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
  };
  if (patch.isActive !== undefined) payload.isActive = Boolean(patch.isActive);
  if (patch.role !== undefined) payload.role = patch.role;
  if (patch.displayName !== undefined) {
    payload.displayName = sanitizeBoundedString(
      patch.displayName,
      BLUEPRINT_LIMITS.DISPLAY_NAME_MAX,
      currentAdmin.displayName || 'Asesor'
    );
  }

  try {
    await updateDoc(doc(db, 'admins', targetUid), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteFirestoreAdminAccount(targetUid: string): Promise<void> {
  const path = `admins/${targetUid}`;
  try {
    await deleteDoc(doc(db, 'admins', targetUid));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// ============================================================================
// 4. LEADS, UNIQUENESS LOCKS, ACTIVITIES & ATTACHMENTS (/leads/{leadId})
// ============================================================================
function mapFirestoreDocToLeadDTO(
  docId: string,
  d: Record<string, unknown>,
  subActivities: LeadActivityDTO[] = [],
  subAttachments: LeadAttachmentDTO[] = []
): LeadRecordDTO {
  const numericId = Number(d.numericId) || 1;
  const interestType: InterestType =
    d.interestType === 'moto' || d.interestType === 'inmueble' ? d.interestType : 'vehiculo';
  const isMotorized = interestType === 'vehiculo' || interestType === 'moto';
  const createdAt = timestampToIso(d.createdAt, typeof d.createdAtIso === 'string' ? d.createdAtIso : undefined);
  const updatedAt = timestampToIso(d.updatedAt, createdAt);

  const availableAmountNum = Number(d.availableAmount) || 0;
  const estimatedTotalNum = Number(d.estimatedTotalAmount) || 0;
  const vBrand = typeof d.vehicleBrand === 'string' ? d.vehicleBrand : '';
  const vModel = typeof d.vehicleModel === 'string' ? d.vehicleModel : '';
  const vCondition = d.vehicleCondition === 'Usado' ? 'Usado' : 'Nuevo';
  const vYear = Number(d.vehicleYear) || new Date().getFullYear();

  const syntheticIntakeNote: LeadActivityDTO = {
    id: numericId * 10 + 1,
    leadId: numericId,
    advisorUid: null,
    advisorName: 'Sistema de Captación Web',
    activityType: 'nota',
    title: 'Solicitud recibida en Firebase Cloud',
    description: isMotorized
      ? `Interés en ${interestType === 'moto' ? 'moto' : 'vehículo'} ${vCondition}: ${vBrand} ${vModel} (${vYear}). Monto disponible: $${availableAmountNum.toLocaleString('en-US')}.`
      : `Interés en financiamiento inmobiliario. Confirmó propiedad vista y monto conocido. Capital disponible: $${availableAmountNum.toLocaleString('en-US')}.`,
    scheduledAt: null,
    reminderEnabled: false,
    completed: true,
    createdAt,
  };

  const mergedActivities =
    subActivities.length > 0 ? [...subActivities, syntheticIntakeNote] : [syntheticIntakeNote];

  return {
    id: numericId,
    firestoreDocId: docId,
    firstName: String(d.firstName || ''),
    lastName: String(d.lastName || ''),
    cedula: String(d.cedula || ''),
    phone: String(d.phone || ''),
    email: String(d.email || ''),
    city: String(d.city || 'Valencia'),
    availableAmount: availableAmountNum.toFixed(2),
    interestType,
    status: (d.status as LeadStatus) || 'Nuevo',
    nextCallAt:
      typeof d.nextCallAtIso === 'string' && d.nextCallAtIso.length > 0 ? d.nextCallAtIso : null,
    assignedAdvisorUid:
      typeof d.assignedAdvisorUid === 'string' && d.assignedAdvisorUid.length > 0
        ? d.assignedAdvisorUid
        : null,
    source: typeof d.source === 'string' ? d.source : 'Formulario Web',
    createdAt,
    updatedAt,
    vehicleRequest: isMotorized
      ? {
          id: numericId,
          leadId: numericId,
          condition: vCondition,
          year: vYear,
          brand: vBrand,
          model: vModel,
          estimatedTotalAmount: estimatedTotalNum > 0 ? estimatedTotalNum.toFixed(2) : null,
          selectedPlan:
            typeof d.selectedPlan === 'string' && d.selectedPlan.length > 0 ? d.selectedPlan : null,
          createdAt,
        }
      : null,
    propertyRequest: !isMotorized
      ? {
          id: numericId,
          leadId: numericId,
          propertySeenConfirmed: Boolean(d.propertySeenConfirmed),
          propertyCategory:
            typeof d.propertyCategory === 'string' && d.propertyCategory.length > 0
              ? d.propertyCategory
              : 'Vivienda / Comercial',
          estimatedPropertyAmount: estimatedTotalNum > 0 ? estimatedTotalNum.toFixed(2) : null,
          locationNotes:
            typeof d.locationNotes === 'string' && d.locationNotes.length > 0
              ? d.locationNotes
              : null,
          createdAt,
        }
      : null,
    activities: mergedActivities,
    attachments: subAttachments,
  };
}

export async function createFirestoreLead(
  payload: CreatePublicLeadPayload,
  options?: { forcedNumericId?: number; forcedCreatedAtIso?: string }
): Promise<LeadRecordDTO> {
  const numericId = options?.forcedNumericId || generateNumericId();
  const randSuffix = Math.random().toString(36).slice(2, 7);
  const leadDocId = `lead_${numericId}_${randSuffix}`;

  const cleanFirstName = sanitizeBoundedString(payload.firstName, BLUEPRINT_LIMITS.NAME_MAX, 'Cliente');
  const cleanLastName = sanitizeBoundedString(payload.lastName, BLUEPRINT_LIMITS.NAME_MAX, 'Autofin');
  const cleanCedula = sanitizeBoundedString(payload.cedula, BLUEPRINT_LIMITS.CEDULA_MAX);
  const cleanPhone = sanitizeBoundedString(payload.phone, BLUEPRINT_LIMITS.PHONE_MAX);
  const cleanEmail = payload.email.trim().toLowerCase().slice(0, BLUEPRINT_LIMITS.EMAIL_MAX);
  const cleanCity = sanitizeBoundedString(payload.city, BLUEPRINT_LIMITS.CITY_MAX, 'Valencia');

  if (!BLUEPRINT_LIMITS.EMAIL_PATTERN.test(cleanEmail)) {
    throw new Error('Por favor ingrese una dirección de correo electrónico válida.');
  }

  const cedulaLockId = buildCedulaLockId(cleanCedula);
  const phoneLockId = buildPhoneLockId(cleanPhone);
  const emailLockId = buildEmailLockId(cleanEmail);

  const isMotorized = payload.interestType === 'vehiculo' || payload.interestType === 'moto';
  const source: 'Formulario Web' | 'Asesor CRM' =
    payload.source === 'Asesor CRM' && auth.currentUser ? 'Asesor CRM' : 'Formulario Web';

  const nowIso = options?.forcedCreatedAtIso || new Date().toISOString();
  const nextCallAtIso = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  const availableAmount = Math.min(100000000, Math.max(0, Number(payload.availableAmount) || 0));
  const estimatedTotalAmount = isMotorized
    ? Math.min(100000000, Math.max(0, Number(payload.vehicle?.estimatedTotalAmount) || 0))
    : Math.min(100000000, Math.max(0, Number(payload.property?.estimatedPropertyAmount) || 0));

  const assignedAdvisorUid =
    source === 'Asesor CRM' && auth.currentUser ? auth.currentUser.uid : '';

  const leadDocData = {
    numericId,
    docId: leadDocId,
    firstName: cleanFirstName,
    lastName: cleanLastName,
    cedula: cleanCedula,
    phone: cleanPhone,
    email: cleanEmail,
    city: cleanCity,
    availableAmount,
    interestType: payload.interestType,
    status: 'Nuevo' as const,
    source,
    nextCallAtIso,
    assignedAdvisorUid,
    vehicleCondition: isMotorized ? (payload.vehicle?.condition === 'Usado' ? 'Usado' : 'Nuevo') : '',
    vehicleYear: isMotorized
      ? Math.min(2030, Math.max(1990, Math.round(Number(payload.vehicle?.year) || new Date().getFullYear())))
      : 0,
    vehicleBrand: isMotorized
      ? sanitizeBoundedString(payload.vehicle?.brand, BLUEPRINT_LIMITS.BRAND_MAX)
      : '',
    vehicleModel: isMotorized
      ? sanitizeBoundedString(payload.vehicle?.model, BLUEPRINT_LIMITS.MODEL_MAX)
      : '',
    estimatedTotalAmount,
    selectedPlan: '',
    propertySeenConfirmed: !isMotorized ? Boolean(payload.property?.propertySeenConfirmed) : false,
    propertyCategory: !isMotorized
      ? sanitizeBoundedString(payload.property?.propertyCategory, 100, 'Vivienda / Comercial')
      : '',
    locationNotes: !isMotorized
      ? sanitizeBoundedString(payload.property?.locationNotes, BLUEPRINT_LIMITS.NOTES_MAX)
      : '',
    cedulaLockId,
    phoneLockId,
    emailLockId,
    createdAtIso: nowIso,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const batch = writeBatch(db);
  batch.set(doc(db, 'leads', leadDocId), leadDocData);
  batch.set(doc(db, 'leadLocks', cedulaLockId), {
    lockId: cedulaLockId,
    lockType: 'cedula',
    leadDocId,
    createdAt: serverTimestamp(),
  });
  batch.set(doc(db, 'leadLocks', phoneLockId), {
    lockId: phoneLockId,
    lockType: 'phone',
    leadDocId,
    createdAt: serverTimestamp(),
  });
  batch.set(doc(db, 'leadLocks', emailLockId), {
    lockId: emailLockId,
    lockType: 'email',
    leadDocId,
    createdAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `leads/${leadDocId}`);
  }

  return mapFirestoreDocToLeadDTO(leadDocId, {
    ...leadDocData,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  });
}

async function fetchSubcollectionsForLead(
  leadDocId: string,
  numericLeadId: number,
  currentUid: string,
  isBootstrapped: boolean
): Promise<{ activities: LeadActivityDTO[]; attachments: LeadAttachmentDTO[] }> {
  const actQuery = isBootstrapped
    ? query(collection(db, 'leads', leadDocId, 'activities'), orderBy('createdAt', 'desc'))
    : query(
        collection(db, 'leads', leadDocId, 'activities'),
        where('advisorUid', '==', currentUid)
      );

  const attQuery = isBootstrapped
    ? query(collection(db, 'leads', leadDocId, 'attachments'), orderBy('createdAt', 'desc'))
    : query(
        collection(db, 'leads', leadDocId, 'attachments'),
        where('uploadedByUid', '==', currentUid)
      );

  let activities: LeadActivityDTO[] = [];
  let attachments: LeadAttachmentDTO[] = [];

  try {
    const actSnap = await getDocs(actQuery);
    activities = actSnap.docs.map((s) => {
      const d = s.data();
      return {
        id: Number(d.numericId) || 1,
        leadId: numericLeadId,
        firestoreDocId: s.id,
        advisorUid: typeof d.advisorUid === 'string' ? d.advisorUid : null,
        advisorName: typeof d.advisorName === 'string' ? d.advisorName : 'Asesor Autofin',
        activityType: String(d.activityType || 'nota'),
        title: String(d.title || ''),
        description: String(d.description || ''),
        scheduledAt:
          typeof d.scheduledAtIso === 'string' && d.scheduledAtIso.length > 0
            ? d.scheduledAtIso
            : null,
        reminderEnabled: Boolean(d.reminderEnabled),
        completed: Boolean(d.completed),
        createdAt: timestampToIso(d.createdAt, typeof d.createdAtIso === 'string' ? d.createdAtIso : undefined),
      };
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, `leads/${leadDocId}/activities`);
  }

  try {
    const attSnap = await getDocs(attQuery);
    attachments = attSnap.docs.map((s) => {
      const d = s.data();
      return {
        id: Number(d.numericId) || 1,
        leadId: numericLeadId,
        firestoreDocId: s.id,
        fileName: String(d.fileName || 'archivo'),
        mimeType: String(d.mimeType || 'application/octet-stream'),
        fileSize: Number(d.fileSize) || 0,
        dataUrl: String(d.dataUrl || ''),
        caption: typeof d.caption === 'string' && d.caption.length > 0 ? d.caption : null,
        uploadedBy: typeof d.uploadedBy === 'string' ? d.uploadedBy : 'Asesor Autofin',
        createdAt: timestampToIso(d.createdAt, typeof d.createdAtIso === 'string' ? d.createdAtIso : undefined),
      };
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, `leads/${leadDocId}/attachments`);
  }

  return { activities, attachments };
}

export function subscribeFirestoreLeads(
  onLeadsUpdated: (leads: LeadRecordDTO[]) => void
): Unsubscribe | null {
  const currentUser = auth.currentUser;
  if (!currentUser?.email) return null;

  const isBootstrapped = currentUser.email.trim().toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL;
  const leadsQuery = isBootstrapped
    ? query(collection(db, 'leads'), orderBy('createdAt', 'desc'))
    : query(collection(db, 'leads'), where('assignedAdvisorUid', '==', currentUser.uid));

  return onSnapshot(
    leadsQuery,
    async (snapshot) => {
      const hydrated = await Promise.all(
        snapshot.docs.map(async (leadSnap) => {
          const d = leadSnap.data() as Record<string, unknown>;
          const numericId = Number(d.numericId) || 1;
          const { activities, attachments } = await fetchSubcollectionsForLead(
            leadSnap.id,
            numericId,
            currentUser.uid,
            isBootstrapped
          );
          return mapFirestoreDocToLeadDTO(leadSnap.id, d, activities, attachments);
        })
      );
      onLeadsUpdated(hydrated);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, 'leads');
    }
  );
}

export async function updateFirestoreLead(
  lead: LeadRecordDTO,
  updates: {
    firstName?: string;
    lastName?: string;
    cedula?: string;
    phone?: string;
    email?: string;
    city?: string;
    availableAmount?: number;
    status?: LeadStatus;
    nextCallAt?: string | null;
    assignedAdvisorUid?: string | null;
    estimatedTotalAmount?: number;
    selectedPlan?: string;
  }
): Promise<void> {
  if (!lead.firestoreDocId) return;
  const leadPath = `leads/${lead.firestoreDocId}`;

  const oldCedulaLock = buildCedulaLockId(lead.cedula);
  const oldPhoneLock = buildPhoneLockId(lead.phone);
  const oldEmailLock = buildEmailLockId(lead.email);

  const nextCedula =
    updates.cedula !== undefined
      ? sanitizeBoundedString(updates.cedula, BLUEPRINT_LIMITS.CEDULA_MAX, lead.cedula)
      : lead.cedula;
  const nextPhone =
    updates.phone !== undefined
      ? sanitizeBoundedString(updates.phone, BLUEPRINT_LIMITS.PHONE_MAX, lead.phone)
      : lead.phone;
  const nextEmail =
    updates.email !== undefined
      ? updates.email.trim().toLowerCase().slice(0, BLUEPRINT_LIMITS.EMAIL_MAX)
      : lead.email;

  const newCedulaLock = buildCedulaLockId(nextCedula);
  const newPhoneLock = buildPhoneLockId(nextPhone);
  const newEmailLock = buildEmailLockId(nextEmail);

  const locksChanged =
    newCedulaLock !== oldCedulaLock ||
    newPhoneLock !== oldPhoneLock ||
    newEmailLock !== oldEmailLock ||
    updates.firstName !== undefined ||
    updates.lastName !== undefined ||
    updates.city !== undefined;

  if (!locksChanged) {
    const patch: Record<string, unknown> = {
      updatedAt: serverTimestamp(),
    };
    if (updates.status !== undefined) patch.status = updates.status;
    if (updates.nextCallAt !== undefined) {
      patch.nextCallAtIso = updates.nextCallAt ? updates.nextCallAt.slice(0, 40) : '';
    }
    if (updates.assignedAdvisorUid !== undefined) {
      patch.assignedAdvisorUid = updates.assignedAdvisorUid || '';
    }
    if (updates.availableAmount !== undefined && Number.isFinite(Number(updates.availableAmount))) {
      patch.availableAmount = Math.min(100000000, Math.max(0, Number(updates.availableAmount)));
    }
    if (updates.estimatedTotalAmount !== undefined && Number.isFinite(Number(updates.estimatedTotalAmount))) {
      patch.estimatedTotalAmount = Math.min(100000000, Math.max(0, Number(updates.estimatedTotalAmount)));
    }
    if (updates.selectedPlan !== undefined) {
      patch.selectedPlan = sanitizeBoundedString(updates.selectedPlan, BLUEPRINT_LIMITS.PLAN_MAX);
    }

    try {
      await updateDoc(doc(db, 'leads', lead.firestoreDocId), patch);
      return;
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, leadPath);
    }
  }

  // Action 2: Contact Profile Correction (atomic batch updating locks if changed)
  const batch = writeBatch(db);
  if (newCedulaLock !== oldCedulaLock) {
    batch.delete(doc(db, 'leadLocks', oldCedulaLock));
    batch.set(doc(db, 'leadLocks', newCedulaLock), {
      lockId: newCedulaLock,
      lockType: 'cedula',
      leadDocId: lead.firestoreDocId,
      createdAt: serverTimestamp(),
    });
  }
  if (newPhoneLock !== oldPhoneLock) {
    batch.delete(doc(db, 'leadLocks', oldPhoneLock));
    batch.set(doc(db, 'leadLocks', newPhoneLock), {
      lockId: newPhoneLock,
      lockType: 'phone',
      leadDocId: lead.firestoreDocId,
      createdAt: serverTimestamp(),
    });
  }
  if (newEmailLock !== oldEmailLock) {
    batch.delete(doc(db, 'leadLocks', oldEmailLock));
    batch.set(doc(db, 'leadLocks', newEmailLock), {
      lockId: newEmailLock,
      lockType: 'email',
      leadDocId: lead.firestoreDocId,
      createdAt: serverTimestamp(),
    });
  }

  batch.update(doc(db, 'leads', lead.firestoreDocId), {
    firstName: sanitizeBoundedString(
      updates.firstName ?? lead.firstName,
      BLUEPRINT_LIMITS.NAME_MAX,
      lead.firstName
    ),
    lastName: sanitizeBoundedString(
      updates.lastName ?? lead.lastName,
      BLUEPRINT_LIMITS.NAME_MAX,
      lead.lastName
    ),
    cedula: nextCedula,
    phone: nextPhone,
    email: nextEmail,
    city: sanitizeBoundedString(updates.city ?? lead.city, BLUEPRINT_LIMITS.CITY_MAX, lead.city),
    availableAmount:
      updates.availableAmount !== undefined
        ? Math.min(100000000, Math.max(0, Number(updates.availableAmount)))
        : Number(lead.availableAmount) || 0,
    status: updates.status ?? lead.status,
    nextCallAtIso:
      updates.nextCallAt !== undefined
        ? updates.nextCallAt || ''
        : lead.nextCallAt || '',
    assignedAdvisorUid:
      updates.assignedAdvisorUid !== undefined
        ? updates.assignedAdvisorUid || ''
        : lead.assignedAdvisorUid || '',
    cedulaLockId: newCedulaLock,
    phoneLockId: newPhoneLock,
    emailLockId: newEmailLock,
    updatedAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, leadPath);
  }
}

export async function deleteFirestoreLead(lead: LeadRecordDTO): Promise<void> {
  if (!lead.firestoreDocId) return;
  const docId = lead.firestoreDocId;
  const leadPath = `leads/${docId}`;

  const batch = writeBatch(db);

  for (const act of lead.activities || []) {
    if (act.firestoreDocId) {
      batch.delete(doc(db, 'leads', docId, 'activities', act.firestoreDocId));
    }
  }
  for (const att of lead.attachments || []) {
    if (att.firestoreDocId) {
      batch.delete(doc(db, 'leads', docId, 'attachments', att.firestoreDocId));
    }
  }

  batch.delete(doc(db, 'leadLocks', buildCedulaLockId(lead.cedula)));
  batch.delete(doc(db, 'leadLocks', buildPhoneLockId(lead.phone)));
  batch.delete(doc(db, 'leadLocks', buildEmailLockId(lead.email)));
  batch.delete(doc(db, 'leads', docId));

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, leadPath);
  }
}

export async function addFirestoreLeadActivity(
  lead: LeadRecordDTO,
  payload: {
    activityType: ActivityType | string;
    title: string;
    description: string;
    scheduledAt?: string | null;
    reminderEnabled?: boolean;
    completed?: boolean;
    advisorName?: string;
  }
): Promise<LeadActivityDTO | null> {
  const caller = auth.currentUser;
  if (!lead.firestoreDocId || !caller) return null;

  const numericId = generateNumericId();
  const actDocId = `act_${numericId}`;
  const nowIso = new Date().toISOString();
  const scheduledIso = payload.scheduledAt ? new Date(payload.scheduledAt).toISOString().slice(0, 40) : '';
  const path = `leads/${lead.firestoreDocId}/activities/${actDocId}`;

  const docData = {
    numericId,
    leadDocId: lead.firestoreDocId,
    advisorUid: caller.uid,
    advisorName: sanitizeBoundedString(
      payload.advisorName || caller.displayName || 'Jesús Artahona',
      BLUEPRINT_LIMITS.DISPLAY_NAME_MAX,
      'Asesor Autofin'
    ),
    activityType: payload.activityType,
    title: sanitizeBoundedString(payload.title, BLUEPRINT_LIMITS.ACTIVITY_TITLE_MAX, 'Seguimiento'),
    description: sanitizeBoundedString(
      payload.description,
      BLUEPRINT_LIMITS.ACTIVITY_DESC_MAX,
      'Registro comercial'
    ),
    scheduledAtIso: scheduledIso,
    reminderEnabled: Boolean(payload.reminderEnabled),
    completed: Boolean(payload.completed),
    createdAtIso: nowIso,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'leads', lead.firestoreDocId, 'activities', actDocId), docData);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }

  // Sincronizar estado o próxima llamada en la ficha maestra
  if (payload.activityType === 'llamada' && scheduledIso && !payload.completed) {
    await updateFirestoreLead(lead, { nextCallAt: scheduledIso });
  } else if (payload.activityType === 'cita_presencial' && !payload.completed) {
    await updateFirestoreLead(lead, { status: 'Cita Presencial' });
  }

  return {
    id: numericId,
    leadId: lead.id,
    firestoreDocId: actDocId,
    advisorUid: caller.uid,
    advisorName: docData.advisorName,
    activityType: payload.activityType,
    title: docData.title,
    description: docData.description,
    scheduledAt: scheduledIso || null,
    reminderEnabled: Boolean(payload.reminderEnabled),
    completed: Boolean(payload.completed),
    createdAt: nowIso,
  };
}

export async function toggleFirestoreLeadActivity(
  leadDocId: string,
  activityDocId: string,
  completed: boolean
): Promise<void> {
  const path = `leads/${leadDocId}/activities/${activityDocId}`;
  try {
    await updateDoc(doc(db, 'leads', leadDocId, 'activities', activityDocId), {
      completed: Boolean(completed),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function addFirestoreLeadAttachment(
  lead: LeadRecordDTO,
  payload: {
    fileName: string;
    mimeType: string;
    fileSize: number;
    dataUrl: string;
    caption?: string;
    uploadedBy?: string;
  }
): Promise<LeadAttachmentDTO | null> {
  const caller = auth.currentUser;
  if (!lead.firestoreDocId || !caller) return null;

  if (
    payload.fileSize > BLUEPRINT_LIMITS.ATTACHMENT_MAX_BYTES ||
    payload.dataUrl.length > BLUEPRINT_LIMITS.ATTACHMENT_DATAURL_MAX
  ) {
    throw new Error('El adjunto excede el límite de almacenamiento en la nube (máx. 680 KB optimizado).');
  }

  const numericId = generateNumericId();
  const attDocId = `att_${numericId}`;
  const nowIso = new Date().toISOString();
  const path = `leads/${lead.firestoreDocId}/attachments/${attDocId}`;

  const docData = {
    numericId,
    leadDocId: lead.firestoreDocId,
    uploadedByUid: caller.uid,
    uploadedBy: sanitizeBoundedString(
      payload.uploadedBy || caller.displayName || 'Jesús Artahona',
      BLUEPRINT_LIMITS.DISPLAY_NAME_MAX,
      'Asesor Autofin'
    ),
    fileName: sanitizeBoundedString(
      payload.fileName,
      BLUEPRINT_LIMITS.ATTACHMENT_FILENAME_MAX,
      'adjunto'
    ),
    mimeType: sanitizeBoundedString(payload.mimeType, 100, 'application/octet-stream'),
    fileSize: Math.max(1, Math.round(payload.fileSize)),
    dataUrl: payload.dataUrl,
    caption: sanitizeBoundedString(payload.caption, BLUEPRINT_LIMITS.ATTACHMENT_CAPTION_MAX),
    createdAtIso: nowIso,
    createdAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'leads', lead.firestoreDocId, 'attachments', attDocId), docData);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }

  return {
    id: numericId,
    leadId: lead.id,
    firestoreDocId: attDocId,
    fileName: docData.fileName,
    mimeType: docData.mimeType,
    fileSize: docData.fileSize,
    dataUrl: docData.dataUrl,
    caption: docData.caption || null,
    uploadedBy: docData.uploadedBy,
    createdAt: nowIso,
  };
}

export async function deleteFirestoreLeadAttachment(
  leadDocId: string,
  attachmentDocId: string
): Promise<void> {
  const path = `leads/${leadDocId}/attachments/${attachmentDocId}`;
  try {
    await deleteDoc(doc(db, 'leads', leadDocId, 'attachments', attachmentDocId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}
