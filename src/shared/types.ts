export type InterestType = 'vehiculo' | 'moto' | 'inmueble';

export type AdminRole = 'super_admin' | 'admin' | 'asesor';

export const DEFAULT_ADVISOR_PHOTO_URL =
  '/assets/aistudio/1000487503-mejora-la-calidad-de-esta-imagen_470f35fc.jpg';

export const OFFICIAL_OFFICE_ADDRESS = 'CC Salvamall, Valencia, Carabobo, Venezuela';

export const MAX_ADVISOR_PHOTO_BYTES = 200 * 1024; // Límite estricto foto circular del asesor: 200 KB
export const MAX_HERO_IMAGE_BYTES = 1500 * 1024; // Límite imagen Hero optimizada: 1.5 MB

export interface AdvisorProfileDTO {
  id?: number;
  advisorName: string;
  advisorTitle: string;
  photoUrl: string;
  welcomeBio: string;
  officeAddress: string;
  heroTitle: string;
  heroSubtitle: string;
  heroVehiculoUrl: string | null;
  heroMotoUrl: string | null;
  heroInmuebleUrl: string | null;
  updatedAt?: string;
}

export interface EmailSettingsDTO {
  enabled: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  hasSmtpPass: boolean;
  senderName: string;
  replyToEmail: string;
  advisorNotifyEmail: string;
  sendCopyToAdvisor: boolean;
  configuredReady: boolean;
}

export interface EmailSettingsUpdatePayload {
  enabled?: boolean;
  smtpHost?: string;
  smtpPort?: number;
  smtpSecure?: boolean;
  smtpUser?: string;
  smtpPass?: string;
  senderName?: string;
  replyToEmail?: string;
  advisorNotifyEmail?: string;
  sendCopyToAdvisor?: boolean;
}

export interface EmailDeliveryStatusDTO {
  attempted: boolean;
  sent: boolean;
  recipient: string;
  advisorName: string;
  message: string;
}

export interface AdminUserDTO {
  uid: string;
  username: string | null;
  email: string;
  displayName: string | null;
  role: AdminRole;
  hasPassword: boolean;
  isActive: boolean;
  createdBy: string | null;
  lastLoginAt: string | null;
  createdAt: string;
}

export type LeadStatus =
  | 'Nuevo'
  | 'Contactado'
  | 'Cita Presencial'
  | 'En Financiamiento'
  | 'Cerrado'
  | 'Perdido';

export type ActivityType =
  | 'llamada'
  | 'cita_presencial'
  | 'nota'
  | 'whatsapp'
  | 'sms'
  | 'correo'
  | 'cotizacion';

export interface VehicleRequestDTO {
  id: number;
  leadId: number;
  condition: 'Nuevo' | 'Usado' | string;
  year: number;
  brand: string;
  model: string;
  estimatedTotalAmount: string | null;
  selectedPlan: string | null;
  createdAt: string;
}

export interface PropertyRequestDTO {
  id: number;
  leadId: number;
  propertySeenConfirmed: boolean;
  propertyCategory: string | null;
  estimatedPropertyAmount: string | null;
  locationNotes: string | null;
  createdAt: string;
}

export interface LeadActivityDTO {
  id: number;
  leadId: number;
  advisorUid: string | null;
  advisorName: string | null;
  activityType: ActivityType | string;
  title: string;
  description: string;
  scheduledAt: string | null;
  reminderEnabled: boolean;
  completed: boolean;
  createdAt: string;
}

export interface LeadAttachmentDTO {
  id: number;
  leadId: number;
  fileName: string;
  mimeType: string;
  fileSize: number;
  dataUrl: string;
  caption: string | null;
  uploadedBy: string | null;
  createdAt: string;
}

export interface LeadRecordDTO {
  id: number;
  firstName: string;
  lastName: string;
  cedula: string;
  phone: string;
  email: string;
  city: string;
  availableAmount: string;
  interestType: InterestType;
  status: LeadStatus;
  nextCallAt: string | null;
  assignedAdvisorUid: string | null;
  source: string;
  createdAt: string;
  updatedAt: string;
  vehicleRequest?: VehicleRequestDTO | null;
  propertyRequest?: PropertyRequestDTO | null;
  activities?: LeadActivityDTO[];
  attachments?: LeadAttachmentDTO[];
  emailDelivery?: EmailDeliveryStatusDTO;
}

export interface CalculatorSettingsDTO {
  id?: number;
  defaultAssetAmount?: number;
  baseInstallments: number;
  adminFee: number;
  planGarantizado1Months: number;
  planGarantizado2Months: number;
  planPromoMonths: number;
  planAhorroMonths: number;
  fastDelivery1Pct: number;
  fastDelivery2Pct: number;
  promo4Plus8Pct: number;
  ahorroFastPct: number;
}

export interface CreatePublicLeadPayload {
  firstName: string;
  lastName: string;
  cedula: string;
  phone: string;
  email: string;
  city: string;
  availableAmount: number;
  interestType: InterestType;
  source?: string;
  vehicle?: {
    condition: 'Nuevo' | 'Usado';
    year: number;
    brand: string;
    model: string;
    estimatedTotalAmount?: number;
  };
  property?: {
    propertySeenConfirmed: boolean;
    propertyCategory?: string;
    estimatedPropertyAmount?: number;
    locationNotes?: string;
  };
}
