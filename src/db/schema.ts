import { relations } from 'drizzle-orm';
import {
  boolean,
  integer,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// 1. Administradores y Asesores del CRM (credenciales propias con clave cifrada o Firebase Auth)
export const users = pgTable('users', {
  uid: text('uid').primaryKey(),
  username: text('username'),
  email: text('email').notNull(),
  displayName: text('display_name'),
  role: text('role').notNull().default('admin'), // 'super_admin' | 'admin' | 'asesor'
  passwordHash: text('password_hash'),
  isActive: boolean('is_active').notNull().default(true),
  createdBy: text('created_by'),
  lastLoginAt: timestamp('last_login_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 2. Clientes / Leads entrantes (Vehículos, Motos e Inmuebles)
export const leads = pgTable(
  'leads',
  {
    id: serial('id').primaryKey(),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    cedula: text('cedula').notNull(),
    phone: text('phone').notNull(),
    email: text('email').notNull(),
    city: text('city').notNull(),
    availableAmount: numeric('available_amount', { precision: 12, scale: 2 }).notNull(),
    interestType: text('interest_type').notNull(), // 'vehiculo' | 'moto' | 'inmueble'
    status: text('status').notNull().default('Nuevo'), // 'Nuevo' | 'Contactado' | 'Cita Presencial' | 'En Financiamiento' | 'Cerrado' | 'Perdido'
    nextCallAt: timestamp('next_call_at'),
    assignedAdvisorUid: text('assigned_advisor_uid').references(() => users.uid),
    source: text('source').notNull().default('Formulario Web'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('leads_cedula_idx').on(table.cedula),
    uniqueIndex('leads_phone_idx').on(table.phone),
    uniqueIndex('leads_email_idx').on(table.email),
  ]
);

// 3. Detalles de Solicitud de Vehículo
export const vehicleRequests = pgTable('vehicle_requests', {
  id: serial('id').primaryKey(),
  leadId: integer('lead_id')
    .references(() => leads.id, { onDelete: 'cascade' })
    .notNull(),
  condition: text('condition').notNull(), // 'Nuevo' | 'Usado'
  year: integer('year').notNull(),
  brand: text('brand').notNull(),
  model: text('model').notNull(),
  estimatedTotalAmount: numeric('estimated_total_amount', { precision: 12, scale: 2 }),
  selectedPlan: text('selected_plan'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 4. Detalles de Solicitud de Inmueble (Viviendas / Galpones Comerciales)
export const propertyRequests = pgTable('property_requests', {
  id: serial('id').primaryKey(),
  leadId: integer('lead_id')
    .references(() => leads.id, { onDelete: 'cascade' })
    .notNull(),
  propertySeenConfirmed: boolean('property_seen_confirmed').notNull().default(true),
  propertyCategory: text('property_category').default('Vivienda / Comercial'),
  estimatedPropertyAmount: numeric('estimated_property_amount', { precision: 12, scale: 2 }),
  locationNotes: text('location_notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 5. Citas, Llamadas e Historial de Interacciones
export const leadActivities = pgTable('lead_activities', {
  id: serial('id').primaryKey(),
  leadId: integer('lead_id')
    .references(() => leads.id, { onDelete: 'cascade' })
    .notNull(),
  advisorUid: text('advisor_uid').references(() => users.uid),
  advisorName: text('advisor_name'),
  activityType: text('activity_type').notNull(), // 'llamada' | 'cita_presencial' | 'nota' | 'whatsapp' | 'sms' | 'correo' | 'cotizacion'
  title: text('title').notNull(),
  description: text('description').notNull(),
  scheduledAt: timestamp('scheduled_at'),
  reminderEnabled: boolean('reminder_enabled').notNull().default(false),
  completed: boolean('completed').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 6. Archivos Adjuntos (Imágenes de vehículos ej. Livan X3 Pro, presupuestos, recaudos)
export const leadAttachments = pgTable('lead_attachments', {
  id: serial('id').primaryKey(),
  leadId: integer('lead_id')
    .references(() => leads.id, { onDelete: 'cascade' })
    .notNull(),
  fileName: text('file_name').notNull(),
  mimeType: text('mime_type').notNull(),
  fileSize: integer('file_size').notNull(),
  dataUrl: text('data_url').notNull(),
  caption: text('caption'),
  uploadedBy: text('uploaded_by'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 7. Configuración de Parámetros de la Calculadora Autofin Venezuela
export const calculatorSettings = pgTable('calculator_settings', {
  id: serial('id').primaryKey(),
  defaultAssetAmount: numeric('default_asset_amount', { precision: 12, scale: 2 })
    .notNull()
    .default('25080.00'),
  baseInstallments: integer('base_installments').notNull().default(60),
  adminFee: numeric('admin_fee', { precision: 12, scale: 2 }).notNull().default('330.60'),
  planGarantizado1Months: integer('plan_garantizado_1_months').notNull().default(24),
  planGarantizado2Months: integer('plan_garantizado_2_months').notNull().default(17),
  planPromoMonths: integer('plan_promo_months').notNull().default(4),
  planAhorroMonths: integer('plan_ahorro_months').notNull().default(1),
  fastDelivery1Pct: numeric('fast_delivery_1_pct', { precision: 5, scale: 2 }).notNull().default('55.00'),
  fastDelivery2Pct: numeric('fast_delivery_2_pct', { precision: 5, scale: 2 }).notNull().default('37.00'),
  promo4Plus8Pct: numeric('promo_4_plus_8_pct', { precision: 5, scale: 2 }).notNull().default('10.00'),
  ahorroFastPct: numeric('ahorro_fast_pct', { precision: 5, scale: 2 }).notNull().default('5.00'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// 8. Perfil Público del Asesor Principal, Sede Oficial e Imágenes Hero de Captación Web
export const advisorProfile = pgTable('advisor_profile', {
  id: serial('id').primaryKey(),
  advisorName: text('advisor_name').notNull().default('Jesús Artahona'),
  advisorTitle: text('advisor_title')
    .notNull()
    .default('Asesor Comercial Oficial · Autofin Venezuela'),
  photoUrl: text('photo_url')
    .notNull()
    .default('/assets/aistudio/1000487503-mejora-la-calidad-de-esta-imagen_470f35fc.jpg'),
  welcomeBio: text('welcome_bio')
    .notNull()
    .default(
      'Atención personalizada desde nuestra sede en CC Salvamall, Valencia, Carabobo, en planes de compra programada y entrega garantizada para vehículos, motos e inmuebles.'
    ),
  officeAddress: text('office_address')
    .notNull()
    .default('CC Salvamall, Valencia, Carabobo, Venezuela'),
  heroTitle: text('hero_title')
    .notNull()
    .default('Planifica tu vehículo, moto o inmueble con cuotas fijas'),
  heroSubtitle: text('hero_subtitle')
    .notNull()
    .default('Sede Oficial · CC Salvamall, Valencia, Carabobo'),
  heroVehiculoUrl: text('hero_vehiculo_url'),
  heroMotoUrl: text('hero_moto_url'),
  heroInmuebleUrl: text('hero_inmueble_url'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// 9. Configuración SMTP para Correo Automático de Confirmación al Cliente
export const emailSettings = pgTable('email_settings', {
  id: serial('id').primaryKey(),
  enabled: boolean('enabled').notNull().default(true),
  smtpHost: text('smtp_host').notNull().default('smtp.gmail.com'),
  smtpPort: integer('smtp_port').notNull().default(465),
  smtpSecure: boolean('smtp_secure').notNull().default(true),
  smtpUser: text('smtp_user'),
  smtpPass: text('smtp_pass'),
  senderName: text('sender_name').notNull().default('Autofin Venezuela · Jesús Artahona'),
  replyToEmail: text('reply_to_email'),
  advisorNotifyEmail: text('advisor_notify_email'),
  sendCopyToAdvisor: boolean('send_copy_to_advisor').notNull().default(true),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Relaciones Drizzle ORM
export const usersRelations = relations(users, ({ many }) => ({
  assignedLeads: many(leads),
  activities: many(leadActivities),
}));

export const leadsRelations = relations(leads, ({ one, many }) => ({
  assignedAdvisor: one(users, {
    fields: [leads.assignedAdvisorUid],
    references: [users.uid],
  }),
  vehicleRequests: many(vehicleRequests),
  propertyRequests: many(propertyRequests),
  activities: many(leadActivities),
  attachments: many(leadAttachments),
}));

export const vehicleRequestsRelations = relations(vehicleRequests, ({ one }) => ({
  lead: one(leads, {
    fields: [vehicleRequests.leadId],
    references: [leads.id],
  }),
}));

export const propertyRequestsRelations = relations(propertyRequests, ({ one }) => ({
  lead: one(leads, {
    fields: [propertyRequests.leadId],
    references: [leads.id],
  }),
}));

export const leadActivitiesRelations = relations(leadActivities, ({ one }) => ({
  lead: one(leads, {
    fields: [leadActivities.leadId],
    references: [leads.id],
  }),
  advisor: one(users, {
    fields: [leadActivities.advisorUid],
    references: [users.uid],
  }),
}));

export const leadAttachmentsRelations = relations(leadAttachments, ({ one }) => ({
  lead: one(leads, {
    fields: [leadAttachments.leadId],
    references: [leads.id],
  }),
}));
