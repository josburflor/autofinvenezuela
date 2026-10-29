import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  BellOff,
  BellRing,
  Calendar,
  CheckCircle2,
  MessageCircle,
  Phone,
  Volume2,
  X,
} from 'lucide-react';
import type { LeadActivityDTO, LeadRecordDTO } from '../shared/types';

export type BrowserNotificationPermission =
  | 'granted'
  | 'denied'
  | 'default'
  | 'unsupported';

export interface DueReminderAlert {
  key: string;
  activity: LeadActivityDTO;
  lead: LeadRecordDTO;
  triggeredAt: number;
}

export interface NewWebLeadAlert {
  key: string;
  lead: LeadRecordDTO;
  receivedAt: string;
}

function sanitizePhoneForWhatsApp(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.startsWith('0')) {
    return `58${digits.slice(1)}`;
  }
  return digits;
}

function playReminderChime() {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const playNote = (freq: number, startOffset: number, duration: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + startOffset);

      gain.gain.setValueAtTime(0.0001, now + startOffset);
      gain.gain.exponentialRampToValueAtTime(0.12, now + startOffset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + startOffset + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + startOffset);
      osc.stop(now + startOffset + duration + 0.02);
    };

    playNote(587.33, 0, 0.18); // D5
    playNote(880.0, 0.16, 0.28); // A5

    setTimeout(() => {
      ctx.close().catch(() => {});
    }, 900);
  } catch {
    // Ignore audio autoplay restrictions if user hasn't interacted yet
  }
}

export function playNewLeadChime() {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const playNote = (freq: number, startOffset: number, duration: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + startOffset);

      gain.gain.setValueAtTime(0.0001, now + startOffset);
      gain.gain.exponentialRampToValueAtTime(0.14, now + startOffset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + startOffset + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + startOffset);
      osc.stop(now + startOffset + duration + 0.02);
    };

    playNote(523.25, 0, 0.15); // C5
    playNote(659.25, 0.14, 0.15); // E5
    playNote(783.99, 0.28, 0.3); // G5

    setTimeout(() => {
      ctx.close().catch(() => {});
    }, 1000);
  } catch {
    // Ignore audio autoplay restrictions
  }
}

export function dispatchNewWebLeadBrowserNotification(
  lead: LeadRecordDTO,
  onOpenLead: (leadId: number) => void
) {
  playNewLeadChime();

  if (
    typeof window !== 'undefined' &&
    'Notification' in window &&
    Notification.permission === 'granted'
  ) {
    try {
      const verticalText =
        lead.interestType === 'moto'
          ? 'Moto'
          : lead.interestType === 'vehiculo'
            ? 'Vehículo'
            : 'Inmueble';
      const n = new Notification(
        `Cliente Nuevo en Captación Web: ${lead.firstName} ${lead.lastName}`,
        {
          body: `${verticalText} · Inicial $${Number(lead.availableAmount || 0).toLocaleString('en-US')} · Tel: ${lead.phone} (${lead.city})`,
          tag: `autofin-new-lead-${lead.id}`,
          requireInteraction: true,
        }
      );
      n.onclick = () => {
        window.focus();
        onOpenLead(lead.id);
        n.close();
      };
    } catch {
      // Fallback handled by in-app toast
    }
  }
}

export function getBrowserNotificationPermission(): BrowserNotificationPermission {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  return Notification.permission;
}

export async function ensureNotificationPermission(): Promise<BrowserNotificationPermission> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  if (Notification.permission === 'granted' || Notification.permission === 'denied') {
    return Notification.permission;
  }
  try {
    const result = await Notification.requestPermission();
    return result;
  } catch {
    return Notification.permission;
  }
}

interface ReminderToolbarControlProps {
  leads: LeadRecordDTO[];
  permission: BrowserNotificationPermission;
  onRequestPermission: () => Promise<void>;
  onSendTestNotification: () => void;
}

export function ReminderToolbarControl({
  leads,
  permission,
  onRequestPermission,
  onSendTestNotification,
}: ReminderToolbarControlProps) {
  const pendingCount = useMemo(() => {
    let count = 0;
    for (const lead of leads) {
      for (const act of lead.activities || []) {
        if (
          !act.completed &&
          act.reminderEnabled &&
          act.scheduledAt &&
          (act.activityType === 'llamada' || act.activityType === 'cita_presencial')
        ) {
          count += 1;
        }
      }
    }
    return count;
  }, [leads]);

  if (permission === 'unsupported') {
    return (
      <div className="inline-flex items-center gap-1.5 px-3 py-2 text-xs text-slate-600 bg-white border border-slate-200 rounded-lg whitespace-nowrap shrink-0">
        <BellOff className="w-3.5 h-3.5 text-slate-400" />
        <span>Alertas internas ({pendingCount})</span>
      </div>
    );
  }

  if (permission === 'granted') {
    return (
      <div className="inline-flex items-center gap-1 bg-white border border-slate-200 rounded-lg p-0.5 shrink-0">
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-emerald-800 whitespace-nowrap">
          <BellRing className="w-3.5 h-3.5 text-emerald-700" />
          <span>
            Recordatorios activos (<span className="font-mono tabular-nums">{pendingCount}</span>)
          </span>
        </span>
        <button
          type="button"
          onClick={onSendTestNotification}
          title="Disparar notificación nativa de prueba"
          className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors whitespace-nowrap shrink-0"
        >
          Probar alerta
        </button>
      </div>
    );
  }

  if (permission === 'denied') {
    return (
      <button
        type="button"
        onClick={onSendTestNotification}
        title="Las notificaciones del sistema están bloqueadas en el navegador; se usarán alertas visuales y sonoras en pantalla"
        className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100 transition-colors whitespace-nowrap shrink-0"
      >
        <Volume2 className="w-3.5 h-3.5 text-amber-700" />
        <span>
          Alerta en pantalla (<span className="font-mono tabular-nums">{pendingCount}</span>)
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onRequestPermission}
      className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-sky-800 bg-sky-50 border border-sky-200 rounded-lg hover:bg-sky-100 transition-colors whitespace-nowrap shrink-0"
    >
      <Bell className="w-3.5 h-3.5 text-sky-700" />
      <span>
        Activar Notificaciones (<span className="font-mono tabular-nums">{pendingCount}</span>)
      </span>
    </button>
  );
}

interface UseActivityRemindersOptions {
  enabled: boolean;
  leads: LeadRecordDTO[];
  onOpenLead: (leadId: number) => void;
  onCompleteActivity: (activityId: number) => Promise<void>;
}

export function useActivityReminders({
  enabled,
  leads,
  onOpenLead,
  onCompleteActivity,
}: UseActivityRemindersOptions) {
  const [permission, setPermission] = useState<BrowserNotificationPermission>(() =>
    getBrowserNotificationPermission()
  );
  const [activeAlerts, setActiveAlerts] = useState<DueReminderAlert[]>([]);
  const notifiedKeysRef = useRef<Set<string>>(new Set());
  const onOpenLeadRef = useRef(onOpenLead);

  useEffect(() => {
    onOpenLeadRef.current = onOpenLead;
  }, [onOpenLead]);

  const syncPermissionState = useCallback(() => {
    setPermission(getBrowserNotificationPermission());
  }, []);

  useEffect(() => {
    window.addEventListener('focus', syncPermissionState);
    return () => window.removeEventListener('focus', syncPermissionState);
  }, [syncPermissionState]);

  const fireBrowserAndAppNotification = useCallback(
    (lead: LeadRecordDTO, activity: LeadActivityDTO, isTest = false) => {
      const isAppointment = activity.activityType === 'cita_presencial';
      const headerTitle = isTest
        ? 'Prueba de Recordatorio — Autofin Venezuela'
        : isAppointment
          ? `Cita Presencial: ${lead.firstName} ${lead.lastName}`
          : `Llamada Agendada: ${lead.firstName} ${lead.lastName}`;

      const scheduledStr = activity.scheduledAt
        ? new Date(activity.scheduledAt).toLocaleTimeString('es-VE', {
            hour: '2-digit',
            minute: '2-digit',
          })
        : 'Ahora';

      const bodyText = `${activity.title} · Tel: ${lead.phone} (${lead.city}) · Hora: ${scheduledStr}`;

      playReminderChime();

      // Disparar API nativa de Notificaciones del navegador si está concedida
      if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
        try {
          const nativeNotification = new Notification(headerTitle, {
            body: bodyText,
            tag: isTest ? `autofin-test-${Date.now()}` : `autofin-activity-${activity.id}`,
            requireInteraction: !isTest,
          });

          nativeNotification.onclick = () => {
            window.focus();
            onOpenLeadRef.current(lead.id);
            nativeNotification.close();
          };
        } catch (err) {
          console.warn('Browser Notification dispatch fallback to in-app alert:', err);
        }
      }

      const alertKey = isTest
        ? `test-${Date.now()}`
        : `${activity.id}-${activity.scheduledAt || 'now'}`;

      setActiveAlerts((prev) => {
        if (prev.some((item) => item.key === alertKey)) return prev;
        return [
          {
            key: alertKey,
            activity,
            lead,
            triggeredAt: Date.now(),
          },
          ...prev,
        ].slice(0, 5);
      });
    },
    []
  );

  const requestPermission = useCallback(async () => {
    const nextPerm = await ensureNotificationPermission();
    setPermission(nextPerm);
  }, []);

  const sendTestNotification = useCallback(async () => {
    let currentPerm = getBrowserNotificationPermission();
    if (currentPerm === 'default') {
      currentPerm = await ensureNotificationPermission();
      setPermission(currentPerm);
    }

    const sampleLead: LeadRecordDTO =
      leads[0] || {
        id: 1,
        firstName: 'María Gabriela',
        lastName: 'Rivas',
        cedula: 'V-24.819.302',
        phone: '+58 412-904-2817',
        email: 'mg.rivas@correo.ve',
        city: 'Caracas',
        availableAmount: '2500.00',
        interestType: 'vehiculo',
        status: 'Contactado',
        nextCallAt: new Date().toISOString(),
        assignedAdvisorUid: null,
        source: 'WhatsApp',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

    const sampleActivity: LeadActivityDTO = {
      id: -1,
      leadId: sampleLead.id,
      advisorUid: null,
      advisorName: 'Sistema de Alertas Autofin',
      activityType: 'llamada',
      title: 'Verificación de recordatorio del navegador',
      description: 'Las alertas nativas y sonoras para llamadas y citas están operativas.',
      scheduledAt: new Date().toISOString(),
      reminderEnabled: true,
      completed: false,
      createdAt: new Date().toISOString(),
    };

    fireBrowserAndAppNotification(sampleLead, sampleActivity, true);
  }, [leads, fireBrowserAndAppNotification]);

  // Monitoreo continuo cada 10 segundos para disparar exactamente al llegar la hora agendada
  useEffect(() => {
    if (!enabled || leads.length === 0) return;

    const evaluateDueReminders = () => {
      const now = Date.now();
      // Ventana: dispara desde 15s antes de la hora exacta hasta 45 minutos después si el asesor acaba de abrir el CRM
      const lookaheadMs = 15 * 1000;
      const maxOverdueWindowMs = 45 * 60 * 1000;

      for (const lead of leads) {
        const activities = lead.activities || [];
        for (const act of activities) {
          if (act.completed || !act.reminderEnabled || !act.scheduledAt) continue;
          if (act.activityType !== 'llamada' && act.activityType !== 'cita_presencial') continue;

          const scheduledMs = new Date(act.scheduledAt).getTime();
          if (Number.isNaN(scheduledMs)) continue;

          const dedupeKey = `${act.id}-${act.scheduledAt}`;
          if (notifiedKeysRef.current.has(dedupeKey)) continue;

          if (now + lookaheadMs >= scheduledMs && now - scheduledMs <= maxOverdueWindowMs) {
            notifiedKeysRef.current.add(dedupeKey);
            fireBrowserAndAppNotification(lead, act, false);
          }
        }
      }
    };

    evaluateDueReminders();
    const intervalId = window.setInterval(evaluateDueReminders, 10_000);
    return () => window.clearInterval(intervalId);
  }, [enabled, leads, fireBrowserAndAppNotification]);

  const dismissAlert = useCallback((key: string) => {
    setActiveAlerts((prev) => prev.filter((a) => a.key !== key));
  }, []);

  const markAlertCompleted = useCallback(
    async (alert: DueReminderAlert) => {
      dismissAlert(alert.key);
      if (alert.activity.id > 0) {
        await onCompleteActivity(alert.activity.id);
      }
    },
    [dismissAlert, onCompleteActivity]
  );

  return {
    permission,
    syncPermissionState,
    requestPermission,
    sendTestNotification,
    activeAlerts,
    dismissAlert,
    markAlertCompleted,
  };
}

interface ReminderToastStackProps {
  alerts: DueReminderAlert[];
  onOpenLead: (leadId: number) => void;
  onDismiss: (key: string) => void;
  onComplete: (alert: DueReminderAlert) => Promise<void>;
}

export function ReminderToastStack({
  alerts,
  onOpenLead,
  onDismiss,
  onComplete,
}: ReminderToastStackProps) {
  if (alerts.length === 0) return null;

  return (
    <div
      aria-live="assertive"
      className="no-print fixed bottom-5 right-5 z-50 w-full max-w-sm space-y-3 pointer-events-none px-4 sm:px-0"
    >
      {alerts.map((alert) => {
        const isAppointment = alert.activity.activityType === 'cita_presencial';
        const isTest = alert.activity.id < 0;
        const scheduledTime = alert.activity.scheduledAt
          ? new Date(alert.activity.scheduledAt).toLocaleTimeString('es-VE', {
              hour: '2-digit',
              minute: '2-digit',
            })
          : 'Ahora';

        const waUrl = `https://wa.me/${sanitizePhoneForWhatsApp(alert.lead.phone)}`;

        return (
          <div
            key={alert.key}
            className="pointer-events-auto bg-white rounded-xl border border-slate-200 shadow-lg p-4 space-y-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-sky-50 border border-sky-200 flex items-center justify-center text-sky-700 shrink-0 mt-0.5">
                  {isAppointment ? (
                    <Calendar className="w-4 h-4" />
                  ) : (
                    <Phone className="w-4 h-4" />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-xs text-slate-500">
                    <span className="font-semibold text-sky-800">
                      {isTest
                        ? 'Prueba de Alerta'
                        : isAppointment
                          ? 'Cita Presencial Ahora'
                          : 'Recordatorio de Llamada'}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">{scheduledTime}</span>
                  </div>
                  <p className="text-sm font-bold text-slate-900 truncate mt-0.5">
                    {alert.lead.firstName} {alert.lead.lastName}
                  </p>
                  <p className="text-xs text-slate-600 line-clamp-2 mt-0.5">
                    {alert.activity.title}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => onDismiss(alert.key)}
                aria-label="Cerrar alerta"
                className="p-1 text-slate-400 hover:text-slate-700 rounded-md hover:bg-slate-100 shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <a
                  href={`tel:${alert.lead.phone.replace(/\s+/g, '')}`}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-white bg-sky-700 rounded-lg hover:bg-sky-800 transition-colors whitespace-nowrap shrink-0"
                >
                  <Phone className="w-3 h-3" />
                  <span>Llamar</span>
                </a>
                <a
                  href={waUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-white bg-emerald-700 rounded-lg hover:bg-emerald-800 transition-colors whitespace-nowrap shrink-0"
                >
                  <MessageCircle className="w-3 h-3" />
                  <span>WhatsApp</span>
                </a>
                <button
                  type="button"
                  onClick={() => {
                    onOpenLead(alert.lead.id);
                    onDismiss(alert.key);
                  }}
                  className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  Ficha
                </button>
              </div>

              {!isTest && (
                <button
                  type="button"
                  onClick={() => onComplete(alert)}
                  title="Marcar actividad como completada"
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Hecha</span>
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

interface NewWebLeadToastStackProps {
  alerts: NewWebLeadAlert[];
  onOpenLead: (leadId: number) => void;
  onGoToNewClientsSection: () => void;
  onDismiss: (key: string) => void;
}

export function NewWebLeadToastStack({
  alerts,
  onOpenLead,
  onGoToNewClientsSection,
  onDismiss,
}: NewWebLeadToastStackProps) {
  if (alerts.length === 0) return null;

  return (
    <div
      aria-live="assertive"
      className="no-print fixed top-20 right-5 z-50 w-full max-w-sm space-y-3 pointer-events-none px-4 sm:px-0"
    >
      {alerts.map((item) => {
        const { lead } = item;
        const waUrl = `https://wa.me/${sanitizePhoneForWhatsApp(lead.phone)}`;
        const verticalLabel =
          lead.interestType === 'moto'
            ? 'Moto'
            : lead.interestType === 'vehiculo'
              ? 'Vehículo'
              : 'Inmueble';
        const requestLabel =
          (lead.interestType === 'vehiculo' || lead.interestType === 'moto') && lead.vehicleRequest
            ? `${lead.vehicleRequest.brand} ${lead.vehicleRequest.model} (${lead.vehicleRequest.year})`
            : 'Propiedad vista confirmada';
        const timeStr = new Date(item.receivedAt).toLocaleTimeString('es-VE', {
          hour: '2-digit',
          minute: '2-digit',
        });

        return (
          <div
            key={item.key}
            className="pointer-events-auto bg-slate-900 text-white rounded-xl border border-slate-700 shadow-xl p-4 space-y-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1 min-w-0">
                <div className="flex items-center gap-1.5 text-xs text-sky-300 font-semibold">
                  <BellRing className="w-3.5 h-3.5 shrink-0" />
                  <span>Alerta: Cliente Nuevo en Captación Web</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums text-slate-300">{timeStr}</span>
                </div>
                <p className="text-sm font-bold text-white truncate">
                  {lead.firstName} {lead.lastName}
                </p>
                <p className="text-xs text-slate-300">
                  {verticalLabel}: {requestLabel} · Inicial{' '}
                  <strong className="font-mono tabular-nums text-white">
                    ${Number(lead.availableAmount || 0).toLocaleString('en-US')}
                  </strong>
                </p>
                <p className="text-xs font-mono tabular-nums text-slate-400">
                  {lead.phone} · {lead.city}
                </p>
              </div>

              <button
                type="button"
                onClick={() => onDismiss(item.key)}
                aria-label="Cerrar alerta de cliente nuevo"
                className="p-1 text-slate-400 hover:text-white rounded-md hover:bg-slate-800 shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="pt-2 border-t border-slate-800 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    onOpenLead(lead.id);
                    onDismiss(item.key);
                  }}
                  className="px-2.5 py-1.5 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-500 rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  Ver Ficha
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onGoToNewClientsSection();
                    onDismiss(item.key);
                  }}
                  className="px-2.5 py-1.5 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  Sección Nuevos
                </button>
              </div>

              <a
                href={waUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <MessageCircle className="w-3 h-3" />
                <span>WhatsApp</span>
              </a>
            </div>
          </div>
        );
      })}
    </div>
  );
}
