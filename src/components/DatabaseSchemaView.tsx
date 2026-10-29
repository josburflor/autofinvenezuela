import React from 'react';
import { Cloud, Database, KeyRound, Link2, ShieldCheck } from 'lucide-react';

interface CollectionSpec {
  path: string;
  entity: string;
  purpose: string;
  securityGate: string;
}

const FIRESTORE_COLLECTIONS: CollectionSpec[] = [
  {
    path: '/admins/{adminUid}',
    entity: 'AdminMember',
    purpose: 'Directorio RBAC de administradores y asesores vinculados a Firebase Auth.',
    securityGate: 'Lectura/Escritura restringida a isAdmin() + correo verificado.',
  },
  {
    path: '/leads/{leadId}',
    entity: 'Lead',
    purpose: 'Expedientes de clientes (Vehículos, Motos e Inmuebles) con aislamiento estricto de PII.',
    securityGate: 'Creación atómica con getAfter(leadLocks); lectura/actualización solo personal activo.',
  },
  {
    path: '/leadLocks/{lockId}',
    entity: 'LeadIdentifierLock',
    purpose: 'Bloqueos atómicos anti-duplicados por cédula (ced_*), teléfono (tel_*) y correo (eml_*).',
    securityGate: 'allow update: if false — impide duplicar identificadores de clientes.',
  },
  {
    path: '/leads/{leadId}/activities/{activityId}',
    entity: 'LeadActivity',
    purpose: 'Subcolección escalable de llamadas agendadas, citas en CC Salvamall Valencia, SMS y notas.',
    securityGate: 'Master Gate exists(/leads/{leadId}) + advisorUid == request.auth.uid.',
  },
  {
    path: '/leads/{leadId}/attachments/{attachmentId}',
    entity: 'LeadAttachment',
    purpose: 'Subcolección de imágenes de vehículos/recaudos optimizados (<= 680 KB por documento).',
    securityGate: 'Master Gate exists(/leads/{leadId}) + inmutabilidad tras carga.',
  },
  {
    path: '/advisorProfiles/main & /portalAssets/{assetId}',
    entity: 'AdvisorProfile / PortalAsset',
    purpose: 'Perfil público de Jesús Artahona, sede Valencia e imágenes Hero editables por rubro.',
    securityGate: 'Lectura puntual get (sin PII); escritura exclusiva de asesores/admins verificados.',
  },
  {
    path: '/calculatorConfigs/main',
    entity: 'CalculatorConfig',
    purpose: 'Parámetros en tiempo real de cuotas, gastos administrativos y planes Autofin Venezuela.',
    securityGate: 'Lectura puntual get; actualización validada por tipo y rango.',
  },
];

interface TableSpec {
  name: string;
  purpose: string;
  columns: Array<{
    name: string;
    type: string;
    constraint: string;
  }>;
}

const SCHEMA_TABLES: TableSpec[] = [
  {
    name: 'users',
    purpose: 'Administradores y asesores con claves cifradas (scrypt) y soporte unificado Firebase Auth.',
    columns: [
      { name: 'uid', type: 'TEXT', constraint: 'PRIMARY KEY' },
      { name: 'username / email', type: 'TEXT', constraint: 'Credenciales únicas de acceso' },
      { name: 'password_hash', type: 'TEXT', constraint: 'Hash cifrado scrypt + salt' },
      { name: 'role', type: 'TEXT', constraint: "'super_admin' | 'admin' | 'asesor'" },
      { name: 'is_active / last_login_at', type: 'BOOLEAN / TIMESTAMP', constraint: 'Estado y auditoría de acceso' },
    ],
  },
  {
    name: 'leads',
    purpose: 'Entidad maestra de prospectos (Vehículos, Motos e Inmuebles) con fecha cronológica de llamada.',
    columns: [
      { name: 'id', type: 'SERIAL', constraint: 'PRIMARY KEY' },
      { name: 'first_name / last_name', type: 'TEXT', constraint: 'NOT NULL' },
      { name: 'cedula', type: 'TEXT', constraint: 'UNIQUE NOT NULL (Sin duplicados)' },
      { name: 'phone / email', type: 'TEXT', constraint: 'UNIQUE NOT NULL (Sin duplicados)' },
      { name: 'city', type: 'TEXT', constraint: 'NOT NULL' },
      { name: 'available_amount', type: 'NUMERIC(12,2)', constraint: 'NOT NULL (Presupuesto inicial)' },
      { name: 'interest_type', type: 'TEXT', constraint: "'vehiculo' | 'moto' | 'inmueble'" },
      { name: 'status', type: 'TEXT', constraint: 'Nuevo · Contactado · Cita Presencial · En Financiamiento · Cerrado · Perdido' },
      { name: 'next_call_at', type: 'TIMESTAMP', constraint: 'Índice de orden cronológico (más próximos primero)' },
      { name: 'assigned_advisor_uid', type: 'TEXT', constraint: 'FK -> users(uid)' },
    ],
  },
  {
    name: 'vehicle_requests & property_requests',
    purpose: 'Especificaciones condicionales para Vehículo, Moto e Inmuebles (Viviendas y Galpones).',
    columns: [
      { name: 'id', type: 'SERIAL', constraint: 'PRIMARY KEY' },
      { name: 'lead_id', type: 'INTEGER', constraint: 'FK -> leads(id) ON DELETE CASCADE' },
      { name: 'condition / year / brand / model', type: 'TEXT / INT', constraint: 'Datos de Vehículo o Moto' },
      { name: 'property_seen_confirmed', type: 'BOOLEAN', constraint: 'Confirmación de propiedad vista' },
      { name: 'estimated_total_amount', type: 'NUMERIC(12,2)', constraint: 'Valor para Calculadora' },
    ],
  },
  {
    name: 'lead_activities & lead_attachments',
    purpose: 'Agenda de llamadas, citas en CC Salvamall Valencia, historial SMS/WhatsApp y adjuntos.',
    columns: [
      { name: 'id', type: 'SERIAL', constraint: 'PRIMARY KEY' },
      { name: 'lead_id', type: 'INTEGER', constraint: 'FK -> leads(id) ON DELETE CASCADE' },
      { name: 'activity_type', type: 'TEXT', constraint: 'llamada · cita_presencial · whatsapp · sms · nota · cotizacion' },
      { name: 'scheduled_at / completed', type: 'TIMESTAMP / BOOL', constraint: 'Recordatorio y cumplimiento' },
    ],
  },
];

export function DatabaseSchemaView() {
  return (
    <div className="space-y-8">
      {/* 1. Arquitectura Cloud Firestore (Firebase) */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="p-6 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Cloud className="w-5 h-5 text-sky-700 shrink-0" />
            <div>
              <h2 className="text-lg font-bold text-slate-900">
                Arquitectura Firebase Cloud Firestore (Zero-Trust Security Rules)
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Persistencia en la nube en tiempo real compatible con Firebase Hosting y sesiones autenticadas
              </p>
            </div>
          </div>
          <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-800">
            <ShieldCheck className="w-4 h-4 text-emerald-700" />
            <span>Reglas Firestore desplegadas y activas</span>
          </div>
        </div>

        <div className="divide-y divide-slate-200">
          {FIRESTORE_COLLECTIONS.map((col) => (
            <div
              key={col.path}
              className="px-6 py-4 flex flex-col md:flex-row md:items-center justify-between gap-3"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-bold text-sky-800">{col.path}</span>
                  <span className="text-slate-300" aria-hidden="true">
                    ·
                  </span>
                  <span className="font-mono text-xs text-slate-600">{col.entity}</span>
                </div>
                <p className="text-xs text-slate-600">{col.purpose}</p>
              </div>
              <div className="text-xs font-medium text-slate-700 md:text-right shrink-0">
                {col.securityGate}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 2. Esquema Relacional PostgreSQL de Respaldo */}
      <div className="space-y-4">
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <div className="flex items-center gap-3">
            <Database className="w-5 h-5 text-slate-700 shrink-0" />
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Esquema Relacional Complementario PostgreSQL (Drizzle ORM)
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Sincronización de respaldo con servidor Express y despacho SMTP
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {SCHEMA_TABLES.map((table) => (
            <div
              key={table.name}
              className="bg-white rounded-xl border border-slate-200 overflow-hidden flex flex-col"
            >
              <div className="px-5 py-4 border-b border-slate-200 bg-slate-50">
                <div className="font-mono text-sm font-semibold text-slate-900">{table.name}</div>
                <p className="text-xs text-slate-600 mt-1">{table.purpose}</p>
              </div>

              <div className="divide-y divide-slate-100 text-xs flex-1">
                {table.columns.map((col) => {
                  const isPk = col.constraint.includes('PRIMARY KEY');
                  const isFk = col.constraint.includes('FK ->');
                  return (
                    <div
                      key={col.name}
                      className="px-5 py-2.5 flex items-center justify-between gap-4"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {isPk && <KeyRound className="w-3.5 h-3.5 text-amber-600 shrink-0" />}
                        {isFk && <Link2 className="w-3.5 h-3.5 text-sky-700 shrink-0" />}
                        <span className="font-mono font-medium text-slate-900 truncate">
                          {col.name}
                        </span>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="font-mono text-slate-500">{col.type}</span>
                        <span className="text-slate-300 mx-1.5" aria-hidden="true">
                          ·
                        </span>
                        <span className="text-slate-600">{col.constraint}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
