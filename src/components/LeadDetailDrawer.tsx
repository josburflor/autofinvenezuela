import React, { useEffect, useRef, useState } from 'react';
import {
  Bell,
  Bike,
  Building2,
  Calendar,
  Car,
  CheckCircle2,
  Clock,
  FileText,
  Image as ImageIcon,
  Mail,
  MessageCircle,
  MessageSquare,
  Paperclip,
  Pencil,
  Phone,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import {
  OFFICIAL_OFFICE_ADDRESS,
  type ActivityType,
  type AdvisorProfileDTO,
  type CalculatorSettingsDTO,
  type LeadRecordDTO,
  type LeadStatus,
} from '../shared/types';
import { FinancingCalculator } from './FinancingCalculator';
import {
  ensureNotificationPermission,
  getBrowserNotificationPermission,
} from './ReminderNotificationManager';

interface LeadDetailDrawerProps {
  lead: LeadRecordDTO;
  advisorProfile?: AdvisorProfileDTO;
  calculatorSettings: CalculatorSettingsDTO;
  onClose: () => void;
  onPermissionUpdated?: () => void;
  onRequestDeleteLead: (lead: LeadRecordDTO) => void;
  onSendConfirmationEmail?: (leadId: number) => Promise<string>;
  onUpdateLead: (
    leadId: number,
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
      estimatedTotalAmount?: number;
      selectedPlan?: string;
    }
  ) => Promise<void>;
  onAddActivity: (
    leadId: number,
    payload: {
      activityType: ActivityType;
      title: string;
      description: string;
      scheduledAt?: string | null;
      reminderEnabled?: boolean;
      completed?: boolean;
    }
  ) => Promise<void>;
  onToggleActivity: (activityId: number, completed: boolean) => Promise<void>;
  onSendSms: (leadId: number, phone: string, message: string) => Promise<void>;
  onUploadAttachment: (
    leadId: number,
    payload: {
      fileName: string;
      mimeType: string;
      fileSize: number;
      dataUrl: string;
      caption?: string;
    }
  ) => Promise<void>;
  onDeleteAttachment: (attachmentId: number) => Promise<void>;
  onSaveCalculatorSettings: (next: CalculatorSettingsDTO) => Promise<void>;
}

const LEAD_STATUS_OPTIONS: LeadStatus[] = [
  'Nuevo',
  'Contactado',
  'Cita Presencial',
  'En Financiamiento',
  'Cerrado',
  'Perdido',
];

function sanitizePhoneForWhatsApp(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.startsWith('0')) {
    return `58${digits.slice(1)}`;
  }
  return digits;
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return 'Sin programar';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Sin programar';
  return d.toLocaleString('es-VE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function toLocalDateTimeInput(targetDate: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const year = targetDate.getFullYear();
  const month = pad(targetDate.getMonth() + 1);
  const day = pad(targetDate.getDate());
  const hours = pad(targetDate.getHours());
  const minutes = pad(targetDate.getMinutes());
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

export function LeadDetailDrawer({
  lead,
  advisorProfile,
  calculatorSettings,
  onClose,
  onPermissionUpdated,
  onRequestDeleteLead,
  onSendConfirmationEmail,
  onUpdateLead,
  onAddActivity,
  onToggleActivity,
  onSendSms,
  onUploadAttachment,
  onDeleteAttachment,
  onSaveCalculatorSettings,
}: LeadDetailDrawerProps) {
  const [activeTab, setActiveTab] = useState<'actividades' | 'calculadora' | 'adjuntos'>(
    'actividades'
  );

  // Edición rápida de datos principales del cliente
  const [isEditingClient, setIsEditingClient] = useState(false);
  const [editFirstName, setEditFirstName] = useState(lead.firstName);
  const [editLastName, setEditLastName] = useState(lead.lastName);
  const [editCedula, setEditCedula] = useState(lead.cedula);
  const [editPhone, setEditPhone] = useState(lead.phone);
  const [editEmail, setEditEmail] = useState(lead.email);
  const [editCity, setEditCity] = useState(lead.city);
  const [editAmount, setEditAmount] = useState(String(lead.availableAmount));
  const [savingClientEdit, setSavingClientEdit] = useState(false);
  const [confirmDeleteAttId, setConfirmDeleteAttId] = useState<number | null>(null);

  useEffect(() => {
    setEditFirstName(lead.firstName);
    setEditLastName(lead.lastName);
    setEditCedula(lead.cedula);
    setEditPhone(lead.phone);
    setEditEmail(lead.email);
    setEditCity(lead.city);
    setEditAmount(String(lead.availableAmount));
    setIsEditingClient(false);
    setConfirmDeleteAttId(null);
  }, [lead.id, lead.firstName, lead.lastName, lead.cedula, lead.phone, lead.email, lead.city, lead.availableAmount]);

  // Estado para agendar Llamada / Cita / Nota
  const [activityType, setActivityType] = useState<ActivityType>('llamada');
  const [actTitle, setActTitle] = useState('');
  const [actDescription, setActDescription] = useState('');
  const [actScheduledAt, setActScheduledAt] = useState('');
  const [actReminder, setActReminder] = useState(true);
  const [savingActivity, setSavingActivity] = useState(false);

  // Estado para envío de SMS
  const [showSmsBox, setShowSmsBox] = useState(false);
  const [smsText, setSmsText] = useState(
    `Hola ${lead.firstName}, te saluda tu asesor de Autofin Venezuela sobre tu solicitud de financiamiento. ¿A qué hora podemos conversar hoy?`
  );
  const [sendingSms, setSendingSms] = useState(false);

  // Estado para subida de adjuntos (ej. fotos de vehículos)
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [attachmentCaption, setAttachmentCaption] = useState('');
  const [uploadingFile, setUploadingFile] = useState(false);
  const [brokenImages, setBrokenImages] = useState<Record<number, boolean>>({});
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);
  const [editErrorMsg, setEditErrorMsg] = useState<string | null>(null);
  const [sendingEmail, setSendingEmail] = useState(false);

  const advisorDisplayName = advisorProfile?.advisorName || 'Jesús Artahona';
  const officeDisplayAddress = advisorProfile?.officeAddress || OFFICIAL_OFFICE_ADDRESS;

  const assetDescription =
    (lead.interestType === 'vehiculo' || lead.interestType === 'moto') && lead.vehicleRequest
      ? `${lead.interestType === 'moto' ? 'Moto: ' : ''}${lead.vehicleRequest.brand} ${lead.vehicleRequest.model} ${lead.vehicleRequest.year} (${lead.vehicleRequest.condition})`
      : 'Financiamiento de Inmueble (Propiedad vista confirmada)';

  const whatsappDirectUrl = `https://wa.me/${sanitizePhoneForWhatsApp(lead.phone)}?text=${encodeURIComponent(
    `Hola ${lead.firstName}, te saluda ${advisorDisplayName} de *Autofin Venezuela* (${officeDisplayAddress}) en referencia a tu solicitud de *${assetDescription}*.`
  )}`;

  const mailtoFallbackUrl = `mailto:${encodeURIComponent(lead.email)}?subject=${encodeURIComponent(
    `Confirmación de Solicitud #${lead.id} — Autofin Venezuela (Asesor: ${advisorDisplayName})`
  )}&body=${encodeURIComponent(
    `Hola ${lead.firstName} ${lead.lastName},\n\nHemos recibido tu solicitud #${lead.id} en Autofin Venezuela.\nTu asesor comercial asignado es ${advisorDisplayName}.\n\nResumen de tus datos:\n- Solicitante: ${lead.firstName} ${lead.lastName} (${lead.cedula})\n- Teléfono: ${lead.phone}\n- Ciudad: ${lead.city}\n- Monto inicial disponible: $${Number(lead.availableAmount).toLocaleString('en-US', { minimumFractionDigits: 2 })} USD\n- Solicitud: ${assetDescription}\n\nSede Oficial: ${officeDisplayAddress}\n\nAtentamente,\n${advisorDisplayName}\nAutofin Venezuela`
  )}`;

  const handleDispatchSummaryEmail = async () => {
    if (!onSendConfirmationEmail) return;
    setSendingEmail(true);
    setFeedbackMsg(null);
    try {
      const msg = await onSendConfirmationEmail(lead.id);
      setFeedbackMsg(msg);
      setTimeout(() => setFeedbackMsg(null), 5000);
    } catch (err: unknown) {
      setFeedbackMsg(
        err instanceof Error
          ? err.message
          : 'No se pudo enviar el correo vía SMTP. Verifique la configuración en Portal y Calculadora.'
      );
    } finally {
      setSendingEmail(false);
    }
  };

  const handleStatusChange = async (nextStatus: LeadStatus) => {
    await onUpdateLead(lead.id, { status: nextStatus });
  };

  const handleSaveClientInfo = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingClientEdit(true);
    setFeedbackMsg(null);
    setEditErrorMsg(null);
    try {
      await onUpdateLead(lead.id, {
        firstName: editFirstName,
        lastName: editLastName,
        cedula: editCedula,
        phone: editPhone,
        email: editEmail,
        city: editCity,
        availableAmount: Number(editAmount) || 0,
      });
      setIsEditingClient(false);
      setFeedbackMsg('Datos personales y monto disponible actualizados en PostgreSQL.');
      setTimeout(() => setFeedbackMsg(null), 3500);
    } catch (err: unknown) {
      setEditErrorMsg(
        err instanceof Error
          ? err.message
          : 'No se pudo actualizar el cliente. Verifique que la cédula, teléfono o correo no estén repetidos.'
      );
    } finally {
      setSavingClientEdit(false);
    }
  };

  const handleCreateActivity = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actTitle.trim() || !actDescription.trim()) return;

    const needsSchedule = activityType === 'llamada' || activityType === 'cita_presencial';
    if (needsSchedule && !actScheduledAt) {
      setFeedbackMsg('Indique la fecha y hora para agendar la llamada o cita presencial.');
      return;
    }

    setSavingActivity(true);
    setFeedbackMsg(null);
    try {
      let permResult = getBrowserNotificationPermission();
      if (needsSchedule && actReminder && permResult === 'default') {
        permResult = await ensureNotificationPermission();
        if (onPermissionUpdated) onPermissionUpdated();
      }

      await onAddActivity(lead.id, {
        activityType,
        title: actTitle,
        description: actDescription,
        scheduledAt: actScheduledAt ? new Date(actScheduledAt).toISOString() : null,
        reminderEnabled: needsSchedule ? actReminder : false,
        completed: !needsSchedule,
      });
      setActTitle('');
      setActDescription('');
      setActScheduledAt('');

      const reminderSuffix =
        needsSchedule && actReminder
          ? permResult === 'granted'
            ? ' Se enviará una notificación nativa del navegador a la hora programada.'
            : ' Se mostrará una alerta sonora y visual en pantalla a la hora programada.'
          : '';

      setFeedbackMsg(`Actividad registrada correctamente en el expediente.${reminderSuffix}`);
      setTimeout(() => setFeedbackMsg(null), 4000);
    } finally {
      setSavingActivity(false);
    }
  };

  const handleDispatchSms = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!smsText.trim()) return;
    setSendingSms(true);
    setFeedbackMsg(null);
    try {
      await onSendSms(lead.id, lead.phone, smsText);
      setShowSmsBox(false);
      setFeedbackMsg(`SMS enviado y registrado en el historial de ${lead.firstName}.`);
      setTimeout(() => setFeedbackMsg(null), 3500);
    } finally {
      setSendingSms(false);
    }
  };

  const handleLogQuickCall = async () => {
    await onAddActivity(lead.id, {
      activityType: 'llamada',
      title: `Llamada saliente (${lead.phone})`,
      description: 'Marcación iniciada desde botón Click-to-Call en la ficha del cliente.',
      completed: true,
    });
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 6 * 1024 * 1024) {
      setFeedbackMsg('El archivo supera el límite de 6 MB.');
      return;
    }

    setUploadingFile(true);
    setFeedbackMsg(null);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const dataUrl = String(reader.result || '');
        await onUploadAttachment(lead.id, {
          fileName: file.name,
          mimeType: file.type || 'application/octet-stream',
          fileSize: file.size,
          dataUrl,
          caption:
            attachmentCaption.trim() || `Adjunto del expediente: ${file.name}`,
        });
        setAttachmentCaption('');
        if (fileInputRef.current) fileInputRef.current.value = '';
        setFeedbackMsg('Archivo adjuntado correctamente a la ficha.');
        setTimeout(() => setFeedbackMsg(null), 3000);
      } finally {
        setUploadingFile(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSaveQuote = async (
    totalAmount: number,
    selectedPlan: string,
    summaryNote: string
  ) => {
    await onUpdateLead(lead.id, {
      estimatedTotalAmount: totalAmount,
      selectedPlan,
    });
    await onAddActivity(lead.id, {
      activityType: 'cotizacion',
      title: `Cotización: ${selectedPlan}`,
      description: summaryNote,
      completed: true,
    });
  };

  return (
    <div className="no-print fixed inset-0 z-40 flex justify-end bg-slate-900/40 backdrop-blur-[1px]">
      <div className="w-full max-w-4xl bg-slate-50 h-full flex flex-col border-l border-slate-200 shadow-xl overflow-hidden">
        {/* Cabecera de Ficha del Cliente */}
        <div className="bg-white border-b border-slate-200 px-6 py-5 space-y-4 shrink-0">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span className="font-mono tabular-nums">Expediente #{lead.id}</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">
                  Registro: {formatDateTime(lead.createdAt)}
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">{lead.cedula}</span>
                <span aria-hidden="true">·</span>
                <span>{lead.city}</span>
                <span aria-hidden="true">·</span>
                <span>Origen: {lead.source}</span>
              </div>
              <h2 className="text-xl sm:text-2xl font-bold text-slate-900 mt-1">
                {lead.firstName} {lead.lastName}
              </h2>
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 mt-1">
                {lead.interestType === 'vehiculo' ? (
                  <Car className="w-3.5 h-3.5 text-sky-700 shrink-0" />
                ) : lead.interestType === 'moto' ? (
                  <Bike className="w-3.5 h-3.5 text-sky-700 shrink-0" />
                ) : (
                  <Building2 className="w-3.5 h-3.5 text-sky-700 shrink-0" />
                )}
                <span className="font-medium text-slate-800">{assetDescription}</span>
                <span aria-hidden="true">·</span>
                <span>
                  Presupuesto inicial:{' '}
                  <strong className="font-mono tabular-nums text-slate-900">
                    ${Number(lead.availableAmount).toLocaleString('en-US', {
                      minimumFractionDigits: 2,
                    })}
                  </strong>
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setIsEditingClient((v) => !v)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 transition-colors whitespace-nowrap"
              >
                <Pencil className="w-3.5 h-3.5 text-sky-700" />
                <span>{isEditingClient ? 'Cancelar Edición' : 'Editar Datos'}</span>
              </button>

              <button
                type="button"
                onClick={() => onRequestDeleteLead(lead)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-red-700 bg-red-50 border border-red-200 hover:bg-red-100 transition-colors whitespace-nowrap"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Eliminar Cliente</span>
              </button>

              <button
                type="button"
                onClick={onClose}
                aria-label="Cerrar ficha del cliente"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-700 bg-slate-100 hover:text-slate-900 hover:bg-slate-200 transition-colors whitespace-nowrap"
              >
                <X className="w-4 h-4" />
                <span>Cerrar</span>
              </button>
            </div>
          </div>

          {/* Formulario compacto de edición de datos del cliente */}
          {isEditingClient && (
            <form
              onSubmit={handleSaveClientInfo}
              className="p-4 rounded-lg bg-slate-50 border border-slate-200 space-y-3"
            >
              {editErrorMsg && (
                <div className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs font-medium text-red-800">
                  {editErrorMsg}
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 mb-1">
                    Nombre *
                  </label>
                  <input
                    type="text"
                    required
                    value={editFirstName}
                    onChange={(e) => setEditFirstName(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs rounded border border-slate-300 bg-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 mb-1">
                    Apellido *
                  </label>
                  <input
                    type="text"
                    required
                    value={editLastName}
                    onChange={(e) => setEditLastName(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs rounded border border-slate-300 bg-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 mb-1">
                    Cédula *
                  </label>
                  <input
                    type="text"
                    required
                    value={editCedula}
                    onChange={(e) => setEditCedula(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs font-mono rounded border border-slate-300 bg-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 mb-1">
                    Teléfono *
                  </label>
                  <input
                    type="text"
                    required
                    value={editPhone}
                    onChange={(e) => setEditPhone(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs font-mono rounded border border-slate-300 bg-white"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 mb-1">
                    Correo Electrónico *
                  </label>
                  <input
                    type="email"
                    required
                    value={editEmail}
                    onChange={(e) => setEditEmail(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs rounded border border-slate-300 bg-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 mb-1">
                    Ciudad *
                  </label>
                  <input
                    type="text"
                    required
                    value={editCity}
                    onChange={(e) => setEditCity(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs rounded border border-slate-300 bg-white"
                  />
                </div>
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">
                      Monto Disponible ($) *
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      required
                      value={editAmount}
                      onChange={(e) => setEditAmount(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs font-mono rounded border border-slate-300 bg-white"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={savingClientEdit}
                    className="px-3.5 py-1.5 text-xs font-semibold text-white bg-sky-700 rounded-lg hover:bg-sky-800 disabled:opacity-60 whitespace-nowrap"
                  >
                    {savingClientEdit ? 'Guardando...' : 'Guardar'}
                  </button>
                </div>
              </div>
            </form>
          )}

          {/* Barra de Comunicaciones Directas + Estado */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100">
            <div className="flex flex-wrap items-center gap-2">
              {/* WhatsApp Directo */}
              <a
                href={whatsappDirectUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-white bg-emerald-700 rounded-lg hover:bg-emerald-800 transition-colors whitespace-nowrap shrink-0"
              >
                <MessageCircle className="w-3.5 h-3.5" />
                <span>WhatsApp ({lead.phone})</span>
              </a>

              {/* Click to Call */}
              <a
                href={`tel:${lead.phone.replace(/\s+/g, '')}`}
                onClick={handleLogQuickCall}
                className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-white bg-sky-700 rounded-lg hover:bg-sky-800 transition-colors whitespace-nowrap shrink-0"
              >
                <Phone className="w-3.5 h-3.5" />
                <span>Llamar (Click to Call)</span>
              </a>

              {/* Enviar SMS */}
              <button
                type="button"
                onClick={() => setShowSmsBox((v) => !v)}
                className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-slate-800 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors whitespace-nowrap shrink-0"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                <span>Enviar SMS</span>
              </button>

              {/* Enviar Resumen por Correo (SMTP) */}
              {onSendConfirmationEmail && (
                <button
                  type="button"
                  disabled={sendingEmail}
                  onClick={handleDispatchSummaryEmail}
                  className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-sky-900 bg-sky-50 border border-sky-200 rounded-lg hover:bg-sky-100 disabled:opacity-60 transition-colors whitespace-nowrap shrink-0"
                >
                  <Mail className="w-3.5 h-3.5 text-sky-700" />
                  <span>{sendingEmail ? 'Enviando correo...' : 'Enviar Resumen por Correo'}</span>
                </button>
              )}

              {/* Abrir en aplicación de correo local */}
              <a
                href={mailtoFallbackUrl}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
                title="Abrir borrador de correo con resumen en su aplicación de correo"
              >
                <Mail className="w-3.5 h-3.5 text-slate-500" />
                <span>Abrir Correo</span>
              </a>
            </div>

            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-slate-600 whitespace-nowrap">
                Estado:
              </label>
              <select
                value={lead.status}
                onChange={(e) => handleStatusChange(e.target.value as LeadStatus)}
                className="px-3 py-1.5 text-xs font-semibold text-slate-900 bg-slate-100 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-600"
              >
                {LEAD_STATUS_OPTIONS.map((st) => (
                  <option key={st} value={st}>
                    {st}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Compositor de SMS Integrado */}
          {showSmsBox && (
            <form
              onSubmit={handleDispatchSms}
              className="p-4 rounded-lg bg-slate-50 border border-slate-200 space-y-3"
            >
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-800">
                  Enviar Mensaje de Texto (SMS) a{' '}
                  <span className="font-mono tabular-nums">{lead.phone}</span>
                </span>
                <span className="font-mono tabular-nums text-slate-500">
                  {smsText.length}/160 caracteres
                </span>
              </div>
              <textarea
                rows={2}
                required
                value={smsText}
                onChange={(e) => setSmsText(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-sky-600"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowSmsBox(false)}
                  className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={sendingSms}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-60"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{sendingSms ? 'Enviando...' : 'Despachar SMS'}</span>
                </button>
              </div>
            </form>
          )}

          {/* Navegación interna de la Ficha */}
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg w-fit">
            <button
              type="button"
              onClick={() => setActiveTab('actividades')}
              className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'actividades'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Agenda e Historial ({lead.activities?.length || 0})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('calculadora')}
              className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'calculadora'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Calculadora Autofin
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('adjuntos')}
              className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'adjuntos'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Archivos y Fotos ({lead.attachments?.length || 0})
            </button>
          </div>
        </div>

        {/* Contenido desplazable de la Ficha */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {feedbackMsg && (
            <div className="p-3.5 rounded-lg bg-sky-50 border border-sky-200 text-xs font-medium text-sky-900">
              {feedbackMsg}
            </div>
          )}

          {activeTab === 'actividades' && (
            <div className="space-y-6">
              {/* Formulario para Agendar Llamada / Cita Presencial / Nota */}
              <form
                onSubmit={handleCreateActivity}
                className="bg-white rounded-xl border border-slate-200 p-5 space-y-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-bold text-slate-900">
                    Agendar Actividad o Registrar Interacción
                  </h3>
                  <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                    {[
                      { id: 'llamada', label: 'Llamada Telefónica' },
                      { id: 'cita_presencial', label: 'Cita Presencial' },
                      { id: 'nota', label: 'Nota / Correo' },
                    ].map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setActivityType(opt.id as ActivityType)}
                        className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                          activityType === opt.id
                            ? 'bg-white text-slate-900 shadow-sm'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Asunto *
                    </label>
                    <input
                      type="text"
                      required
                      value={actTitle}
                      onChange={(e) => setActTitle(e.target.value)}
                      placeholder={
                        activityType === 'llamada'
                          ? 'Ej. Llamada de revisión de inicial'
                          : activityType === 'cita_presencial'
                            ? 'Ej. Cita en oficina Caracas'
                            : 'Ej. Resumen de conversación'
                      }
                      className="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-600"
                    />
                  </div>

                  {(activityType === 'llamada' || activityType === 'cita_presencial') && (
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Fecha y Hora Programada *
                      </label>
                      <input
                        type="datetime-local"
                        required
                        value={actScheduledAt}
                        onChange={(e) => setActScheduledAt(e.target.value)}
                        className="w-full px-3.5 py-2 text-sm font-mono tabular-nums rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-600"
                      />
                      <div className="flex flex-wrap items-center gap-1.5 mt-2">
                        {[
                          { label: 'En 1 min', mins: 1 },
                          { label: 'En 15 min', mins: 15 },
                          { label: 'En 1 hora', mins: 60 },
                          { label: 'Mañana 9:00', mins: -1 },
                        ].map((preset) => (
                          <button
                            key={preset.label}
                            type="button"
                            onClick={() => {
                              if (preset.mins > 0) {
                                setActScheduledAt(
                                  toLocalDateTimeInput(new Date(Date.now() + preset.mins * 60_000))
                                );
                              } else {
                                const tomorrow = new Date();
                                tomorrow.setDate(tomorrow.getDate() + 1);
                                tomorrow.setHours(9, 0, 0, 0);
                                setActScheduledAt(toLocalDateTimeInput(tomorrow));
                              }
                            }}
                            className="px-2 py-0.5 text-[11px] font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded transition-colors whitespace-nowrap shrink-0"
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Notas / Acuerdos con el Cliente *
                  </label>
                  <textarea
                    rows={2}
                    required
                    value={actDescription}
                    onChange={(e) => setActDescription(e.target.value)}
                    placeholder="Detalle los acuerdos, recaudos solicitados o presupuesto enviado..."
                    className="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-600"
                  />
                </div>

                <div className="flex flex-wrap items-center justify-between gap-4 pt-1">
                  {(activityType === 'llamada' || activityType === 'cita_presencial') ? (
                    <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={actReminder}
                        onChange={async (e) => {
                          const checked = e.target.checked;
                          setActReminder(checked);
                          if (checked && getBrowserNotificationPermission() === 'default') {
                            await ensureNotificationPermission();
                            if (onPermissionUpdated) onPermissionUpdated();
                          }
                        }}
                        className="w-4 h-4 rounded border-slate-300 text-sky-700 focus:ring-sky-600"
                      />
                      <Bell className="w-3.5 h-3.5 text-amber-600" />
                      <span>Activar alerta y notificación del navegador al llegar la hora</span>
                    </label>
                  ) : (
                    <span className="text-xs text-slate-500">
                      Quedará registrada inmediatamente en la bitácora del cliente.
                    </span>
                  )}

                  <button
                    type="submit"
                    disabled={savingActivity}
                    className="px-4 py-2 text-xs font-semibold text-white bg-sky-700 rounded-lg hover:bg-sky-800 disabled:opacity-60 transition-colors whitespace-nowrap shrink-0"
                  >
                    {savingActivity
                      ? 'Guardando...'
                      : activityType === 'llamada'
                        ? 'Agendar Llamada'
                        : activityType === 'cita_presencial'
                          ? 'Agendar Cita Presencial'
                          : 'Guardar Nota'}
                  </button>
                </div>
              </form>

              {/* Historial Cronológico de Interacciones */}
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
                  <h3 className="text-sm font-bold text-slate-900">
                    Historial de Interacciones y Citas
                  </h3>
                  <span className="text-xs text-slate-500 font-mono tabular-nums">
                    Próxima llamada: {formatDateTime(lead.nextCallAt)}
                  </span>
                </div>

                {!lead.activities || lead.activities.length === 0 ? (
                  <div className="p-8 text-center text-sm text-slate-500">
                    Aún no hay interacciones registradas para este cliente.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-200">
                    {lead.activities.map((act) => (
                      <div key={act.id} className="p-5 flex items-start justify-between gap-4">
                        <div className="space-y-1.5 min-w-0">
                          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                            <span className="font-semibold text-slate-800 capitalize">
                              {act.activityType.replace('_', ' ')}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span>{act.advisorName || 'Asesor'}</span>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono tabular-nums">
                              {formatDateTime(act.createdAt)}
                            </span>
                            {act.scheduledAt && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="inline-flex items-center gap-1 text-sky-800 font-medium font-mono tabular-nums">
                                  <Calendar className="w-3 h-3" />
                                  Agendado: {formatDateTime(act.scheduledAt)}
                                </span>
                              </>
                            )}
                            {act.reminderEnabled && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="inline-flex items-center gap-1 text-amber-700 font-medium">
                                  <Clock className="w-3 h-3" />
                                  Con recordatorio
                                </span>
                              </>
                            )}
                          </div>
                          <div className="text-sm font-semibold text-slate-900">{act.title}</div>
                          <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-line">
                            {act.description}
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={() => onToggleActivity(act.id, !act.completed)}
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                            act.completed
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                              : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>{act.completed ? 'Completada' : 'Marcar hecha'}</span>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'calculadora' && (
            <FinancingCalculator
              settings={calculatorSettings}
              canConfigure={true}
              onSaveSettings={onSaveCalculatorSettings}
              lead={lead}
              onSaveQuoteToLead={handleSaveQuote}
            />
          )}

          {activeTab === 'adjuntos' && (
            <div className="space-y-6">
              {/* Subida de Fotos de Vehículos / Recaudos */}
              <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
                <div className="flex items-center gap-2.5">
                  <Paperclip className="w-4 h-4 text-sky-700" />
                  <h3 className="text-sm font-bold text-slate-900">
                    Adjuntar Imagen de Vehículo, Presupuesto o Recaudos
                  </h3>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                  <div className="sm:col-span-7">
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Descripción del archivo (Opcional)
                    </label>
                    <input
                      type="text"
                      value={attachmentCaption}
                      onChange={(e) => setAttachmentCaption(e.target.value)}
                      placeholder="Ej. Foto enviada por WhatsApp - Livan X3 Pro Automático 0km"
                      className="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-600"
                    />
                  </div>
                  <div className="sm:col-span-5">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*,.pdf"
                      onChange={handleFileChange}
                      className="hidden"
                      id={`upload-file-${lead.id}`}
                    />
                    <label
                      htmlFor={`upload-file-${lead.id}`}
                      className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-sky-700 rounded-lg hover:bg-sky-800 cursor-pointer transition-colors whitespace-nowrap"
                    >
                      <ImageIcon className="w-4 h-4" />
                      <span>
                        {uploadingFile ? 'Subiendo archivo...' : 'Seleccionar Imagen o PDF'}
                      </span>
                    </label>
                  </div>
                </div>
              </div>

              {/* Galería de Adjuntos */}
              {!lead.attachments || lead.attachments.length === 0 ? (
                <div className="bg-white rounded-xl border border-slate-200 p-10 text-center space-y-2">
                  <FileText className="w-8 h-8 text-slate-400 mx-auto" />
                  <p className="text-sm font-medium text-slate-700">
                    Sin archivos adjuntos en este expediente
                  </p>
                  <p className="text-xs text-slate-500">
                    Adjunte fotografías de referencia del vehículo enviadas por el cliente o
                    recaudos de financiamiento.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  {lead.attachments.map((att) => {
                    const isImage = att.mimeType.startsWith('image/');
                    const failed = brokenImages[att.id];
                    return (
                      <div
                        key={att.id}
                        className="bg-white rounded-xl border border-slate-200 overflow-hidden flex flex-col justify-between"
                      >
                        <div className="h-52 bg-slate-100 flex items-center justify-center overflow-hidden">
                          {isImage && !failed ? (
                            <img
                              src={att.dataUrl}
                              alt={att.caption || att.fileName}
                              referrerPolicy="no-referrer"
                              onError={() =>
                                setBrokenImages((prev) => ({ ...prev, [att.id]: true }))
                              }
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="flex flex-col items-center justify-center text-slate-500 p-6 text-center">
                              <FileText className="w-8 h-8 mb-2 text-sky-700" />
                              <span className="text-xs font-mono truncate max-w-[220px]">
                                {att.fileName}
                              </span>
                            </div>
                          )}
                        </div>
                        <div className="p-4 flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-slate-900 truncate">
                              {att.caption || att.fileName}
                            </p>
                            <p className="text-xs text-slate-500 mt-0.5">
                              {att.uploadedBy || 'Asesor'} ·{' '}
                              <span className="font-mono tabular-nums">
                                {Math.max(1, Math.round(att.fileSize / 1024))} KB
                              </span>
                            </p>
                          </div>
                          {confirmDeleteAttId === att.id ? (
                            <div className="flex items-center gap-1.5 shrink-0">
                              <button
                                type="button"
                                onClick={async () => {
                                  await onDeleteAttachment(att.id);
                                  setConfirmDeleteAttId(null);
                                }}
                                className="px-2 py-1 text-[11px] font-semibold text-white bg-red-700 rounded hover:bg-red-800"
                              >
                                Confirmar
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteAttId(null)}
                                className="px-2 py-1 text-[11px] font-medium text-slate-600 bg-slate-100 rounded hover:bg-slate-200"
                              >
                                Cancelar
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteAttId(att.id)}
                              aria-label="Eliminar archivo adjunto"
                              className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg hover:bg-red-50 transition-colors shrink-0"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
