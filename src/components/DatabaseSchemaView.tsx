import React from 'react';
import { Database, KeyRound, Link2 } from 'lucide-react';

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
    purpose: 'Administradores y asesores con claves cifradas (scrypt) o acceso corporativo y control de sesión.',
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
    name: 'vehicle_requests',
    purpose: 'Especificaciones condicionales cuando el cliente elige financiamiento de Vehículo o Moto.',
    columns: [
      { name: 'id', type: 'SERIAL', constraint: 'PRIMARY KEY' },
      { name: 'lead_id', type: 'INTEGER', constraint: 'FK -> leads(id) ON DELETE CASCADE' },
      { name: 'condition', type: 'TEXT', constraint: "'Nuevo' | 'Usado'" },
      { name: 'year', type: 'INTEGER', constraint: 'NOT NULL' },
      { name: 'brand / model', type: 'TEXT', constraint: 'NOT NULL (Ej. Livan X3 Pro / Empire Keeway RK 200)' },
      { name: 'estimated_total_amount', type: 'NUMERIC(12,2)', constraint: 'Valor para Calculadora' },
      { name: 'selected_plan', type: 'TEXT', constraint: 'Plan cotizado al cliente' },
    ],
  },
  {
    name: 'property_requests',
    purpose: 'Validación condicional de Inmuebles (Viviendas y Galpones Comerciales).',
    columns: [
      { name: 'id', type: 'SERIAL', constraint: 'PRIMARY KEY' },
      { name: 'lead_id', type: 'INTEGER', constraint: 'FK -> leads(id) ON DELETE CASCADE' },
      { name: 'property_seen_confirmed', type: 'BOOLEAN', constraint: 'NOT NULL DEFAULT true (Requisito obligatorio)' },
      { name: 'property_category', type: 'TEXT', constraint: 'Vivienda / Galpón Comercial' },
      { name: 'estimated_property_amount', type: 'NUMERIC(12,2)', constraint: 'Monto conocido del inmueble' },
    ],
  },
  {
    name: 'lead_activities',
    purpose: 'Agenda de llamadas telefónicas, citas presenciales con recordatorio e historial de notas/SMS/WhatsApp.',
    columns: [
      { name: 'id', type: 'SERIAL', constraint: 'PRIMARY KEY' },
      { name: 'lead_id', type: 'INTEGER', constraint: 'FK -> leads(id) ON DELETE CASCADE' },
      { name: 'advisor_uid', type: 'TEXT', constraint: 'FK -> users(uid)' },
      { name: 'activity_type', type: 'TEXT', constraint: 'llamada · cita_presencial · whatsapp · sms · nota · cotizacion' },
      { name: 'scheduled_at', type: 'TIMESTAMP', constraint: 'Fecha y hora de llamada o cita' },
      { name: 'reminder_enabled', type: 'BOOLEAN', constraint: 'Recordatorio activo' },
      { name: 'completed', type: 'BOOLEAN', constraint: 'Estado de cumplimiento' },
    ],
  },
  {
    name: 'lead_attachments',
    purpose: 'Archivos e imágenes adjuntas en la ficha (ej. fotos de vehículos enviadas por WhatsApp).',
    columns: [
      { name: 'id', type: 'SERIAL', constraint: 'PRIMARY KEY' },
      { name: 'lead_id', type: 'INTEGER', constraint: 'FK -> leads(id) ON DELETE CASCADE' },
      { name: 'file_name / mime_type', type: 'TEXT', constraint: 'NOT NULL' },
      { name: 'data_url', type: 'TEXT', constraint: 'Referencia de imagen o documento' },
      { name: 'caption', type: 'TEXT', constraint: 'Nota descriptiva del archivo' },
    ],
  },
  {
    name: 'advisor_profile',
    purpose:
      'Perfil público del asesor (Jesús Artahona), sede oficial en CC Salvamall Valencia e imágenes Hero editables de Captación Web.',
    columns: [
      { name: 'id', type: 'SERIAL', constraint: 'PRIMARY KEY' },
      { name: 'advisor_name', type: 'TEXT', constraint: "DEFAULT 'Jesús Artahona'" },
      { name: 'office_address', type: 'TEXT', constraint: "DEFAULT 'CC Salvamall, Valencia...'" },
      { name: 'photo_url', type: 'TEXT', constraint: 'Foto circular validada <= 200 KB' },
      { name: 'hero_vehiculo_url / moto / inmueble', type: 'TEXT', constraint: 'Imágenes Hero editables desde el Panel' },
    ],
  },
  {
    name: 'email_settings',
    purpose:
      'Configuración SMTP para envío automático de correo de confirmación al cliente nombrando a su asesor asignado.',
    columns: [
      { name: 'id', type: 'SERIAL', constraint: 'PRIMARY KEY' },
      { name: 'enabled', type: 'BOOLEAN', constraint: 'DEFAULT TRUE' },
      { name: 'smtp_host / smtp_port', type: 'TEXT / INT', constraint: 'Servidor SMTP corporativo' },
      { name: 'smtp_user / smtp_pass', type: 'TEXT', constraint: 'Credenciales seguras en servidor' },
      { name: 'sender_name', type: 'TEXT', constraint: "DEFAULT 'Autofin Venezuela · Jesús Artahona'" },
    ],
  },
];

export function DatabaseSchemaView() {
  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <div className="flex items-center gap-3">
          <Database className="w-5 h-5 text-sky-700 shrink-0" />
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              Arquitectura Relacional PostgreSQL (Drizzle ORM)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Modelos normalizados activos para Clientes, Vehículos, Motos, Inmuebles,
              Citas/Actividades y Adjuntos
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
  );
}
