import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BellRing,
  Bike,
  Building2,
  Calculator,
  CalendarClock,
  Camera,
  Car,
  CheckCircle2,
  Clock,
  Eye,
  EyeOff,
  FileSpreadsheet,
  KeyRound,
  Lock,
  LogOut,
  MessageCircle,
  Phone,
  Plus,
  Printer,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  UserCheck,
  X,
} from 'lucide-react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { apiFetch, websocketUrl } from './lib/api-url';
import { PublicLeadForm } from './components/PublicLeadForm';
import { FinancingCalculator } from './components/FinancingCalculator';
import { LeadDetailDrawer } from './components/LeadDetailDrawer';
import { GeminiAdvisorPanel } from './components/GeminiAdvisorPanel';
import { DatabaseSchemaView } from './components/DatabaseSchemaView';
import { AdminManagementPanel } from './components/AdminManagementPanel';
import { AdvisorProfileEditor } from './components/AdvisorProfileEditor';
import { PortalSettingsPanel } from './components/PortalSettingsPanel';
import { ConfirmDeleteModal } from './components/ConfirmDeleteModal';
import { MonthlyAnnualReportPanel } from './components/MonthlyAnnualReportPanel';
import {
  NewWebLeadToastStack,
  ReminderToastStack,
  ReminderToolbarControl,
  dispatchNewWebLeadBrowserNotification,
  useActivityReminders,
  type NewWebLeadAlert,
} from './components/ReminderNotificationManager';
import { DEFAULT_CALCULATOR_SETTINGS } from './shared/calculator';
import {
  DEFAULT_ADVISOR_PHOTO_URL,
  OFFICIAL_OFFICE_ADDRESS,
  type ActivityType,
  type AdminRole,
  type AdvisorProfileDTO,
  type CalculatorSettingsDTO,
  type InterestType,
  type LeadRecordDTO,
  type LeadStatus,
} from './shared/types';

type ActiveSection =
  | 'captacion'
  | 'crm'
  | 'nuevos'
  | 'resumen'
  | 'portal'
  | 'admins'
  | 'esquema';
type LeadSortMode = 'datetime_desc' | 'datetime_asc' | 'call_asc';

const INITIAL_ADVISOR_PROFILE: AdvisorProfileDTO = {
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

function getRoleBadgeText(role: AdminRole): string {
  if (role === 'super_admin') return 'Administrador Principal';
  if (role === 'admin') return 'Administrador';
  return 'Asesor Comercial';
}

function sanitizePhoneForWhatsApp(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.startsWith('0')) {
    return `58${digits.slice(1)}`;
  }
  return digits;
}

function formatCallSchedule(iso: string | null | undefined): string {
  if (!iso) return 'Sin agendar';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Sin agendar';
  return d.toLocaleString('es-VE', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatRegistrationDate(iso: string | null | undefined): {
  datePart: string;
  timePart: string;
} {
  if (!iso) return { datePart: '—', timePart: '' };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { datePart: '—', timePart: '' };
  return {
    datePart: d.toLocaleDateString('es-VE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }),
    timePart: d.toLocaleTimeString('es-VE', {
      hour: '2-digit',
      minute: '2-digit',
    }),
  };
}

function AutofinWorkspace() {
  const {
    user,
    isAdmin,
    loading: authLoading,
    authError,
    clearAuthError,
    signInWithCredentials,
    signOutAdvisor,
    authFetch,
    getAdminToken,
  } = useAuth();

  // Inicio por defecto en Captación Web para los clientes visitantes
  const [activeSection, setActiveSection] = useState<ActiveSection>('captacion');
  const [leads, setLeads] = useState<LeadRecordDTO[]>([]);
  const [loadingLeads, setLoadingLeads] = useState(false);
  const [leadsError, setLeadsError] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);

  // Estado formulario de acceso con usuario y clave
  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [submittingLogin, setSubmittingLogin] = useState(false);

  const [calculatorSettings, setCalculatorSettings] = useState<CalculatorSettingsDTO>(
    DEFAULT_CALCULATOR_SETTINGS
  );
  const [advisorProfile, setAdvisorProfile] =
    useState<AdvisorProfileDTO>(INITIAL_ADVISOR_PROFILE);

  // Monto prellenado desde la Calculadora integrada en Captación Web
  const [prefillFormAmount, setPrefillFormAmount] = useState<number | null>(null);

  // Filtros y ordenamiento del CRM (Por defecto: Fecha y Hora más recientes primero)
  const [categoryFilter, setCategoryFilter] = useState<'todos' | InterestType>('todos');
  const [statusFilter, setStatusFilter] = useState<'Todos' | LeadStatus>('Todos');
  const [sortMode, setSortMode] = useState<LeadSortMode>('datetime_desc');
  const [searchQuery, setSearchQuery] = useState('');

  // Ficha seleccionada, confirmación de eliminación y paneles del asesor
  const [selectedLeadId, setSelectedLeadId] = useState<number | null>(null);
  const [leadPendingDelete, setLeadPendingDelete] = useState<LeadRecordDTO | null>(null);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [showNewLeadModal, setShowNewLeadModal] = useState(false);
  const [showAdvisorPhotoModal, setShowAdvisorPhotoModal] = useState(false);
  const [showAdminCalcConfigModal, setShowAdminCalcConfigModal] = useState(false);

  // Alertas en tiempo real de Clientes Nuevos desde Captación Web
  const [newWebLeadAlerts, setNewWebLeadAlerts] = useState<NewWebLeadAlert[]>([]);
  const knownLeadIdsRef = useRef<Set<number> | null>(null);
  const alertedNewLeadIdsRef = useRef<Set<number>>(new Set());

  const showTemporaryFeedback = useCallback((msg: string) => {
    setActionFeedback(msg);
    window.setTimeout(() => {
      setActionFeedback((curr) => (curr === msg ? null : curr));
    }, 5000);
  }, []);

  const handleOpenLeadFromNotification = useCallback((leadId: number) => {
    setActiveSection('crm');
    setSelectedLeadId(leadId);
  }, []);

  const triggerNewWebLeadAlert = useCallback(
    (incomingLead: LeadRecordDTO, forceTest = false) => {
      if (!forceTest && alertedNewLeadIdsRef.current.has(incomingLead.id)) {
        return;
      }
      if (!forceTest) {
        alertedNewLeadIdsRef.current.add(incomingLead.id);
      }

      dispatchNewWebLeadBrowserNotification(incomingLead, handleOpenLeadFromNotification);

      const alertKey = forceTest
        ? `test-new-lead-${Date.now()}`
        : `new-web-lead-${incomingLead.id}`;

      setNewWebLeadAlerts((prev) => {
        if (prev.some((a) => a.key === alertKey)) return prev;
        return [
          {
            key: alertKey,
            lead: incomingLead,
            receivedAt: incomingLead.createdAt || new Date().toISOString(),
          },
          ...prev,
        ].slice(0, 5);
      });
    },
    [handleOpenLeadFromNotification]
  );

  const dismissNewWebLeadAlert = useCallback((key: string) => {
    setNewWebLeadAlerts((prev) => prev.filter((item) => item.key !== key));
  }, []);

  const handleFullSignOut = useCallback(async () => {
    setSelectedLeadId(null);
    setLeadPendingDelete(null);
    setAssistantOpen(false);
    setShowNewLeadModal(false);
    setShowAdvisorPhotoModal(false);
    setShowAdminCalcConfigModal(false);
    setNewWebLeadAlerts([]);
    knownLeadIdsRef.current = null;
    setLoginPassword('');
    await signOutAdvisor();
    setActiveSection('captacion');
  }, [signOutAdvisor]);

  const handleCredentialLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginIdentifier.trim() || !loginPassword) return;
    setSubmittingLogin(true);
    try {
      const ok = await signInWithCredentials(loginIdentifier, loginPassword);
      if (ok) {
        setLoginPassword('');
      }
    } finally {
      setSubmittingLogin(false);
    }
  };

  const fetchPublicSettings = useCallback(async () => {
    try {
      const [calcRes, profileRes] = await Promise.all([
        apiFetch('/api/public/calculator-settings'),
        apiFetch('/api/public/advisor-profile'),
      ]);
      if (calcRes.ok) {
        const calcData = (await calcRes.json()) as CalculatorSettingsDTO;
        setCalculatorSettings(calcData);
      }
      if (profileRes.ok) {
        const profileData = (await profileRes.json()) as AdvisorProfileDTO;
        setAdvisorProfile(profileData);
      }
    } catch {
      // Keep default settings on network hiccup
    }
  }, []);

  const fetchCrmLeads = useCallback(
    async (silent = false) => {
      if (!user) return;
      if (!silent) {
        setLoadingLeads(true);
        setLeadsError(null);
      }
      try {
        const res = await authFetch('/api/crm/leads');
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Error al cargar la cartera de clientes.');
        }
        const fetched = data as LeadRecordDTO[];

        // Detectar clientes nuevos entrantes durante sincronización silenciosa
        if (knownLeadIdsRef.current === null) {
          knownLeadIdsRef.current = new Set(fetched.map((l) => l.id));
        } else {
          for (const item of fetched) {
            if (!knownLeadIdsRef.current.has(item.id)) {
              knownLeadIdsRef.current.add(item.id);
              if (item.source === 'Formulario Web') {
                triggerNewWebLeadAlert(item);
              }
            }
          }
        }

        setLeads(fetched);
      } catch (err: unknown) {
        if (!silent) {
          setLeadsError(
            err instanceof Error ? err.message : 'No se pudo conectar con Cloud SQL.'
          );
        }
      } finally {
        if (!silent) {
          setLoadingLeads(false);
        }
      }
    },
    [user, authFetch, triggerNewWebLeadAlert]
  );

  useEffect(() => {
    fetchPublicSettings();
  }, [fetchPublicSettings]);

  // Carga inicial + sincronización periódica cada 15s para detectar nuevos leads web
  useEffect(() => {
    if (user) {
      fetchCrmLeads(false);
      const refreshTimer = window.setInterval(() => {
        fetchCrmLeads(true);
      }, 15_000);
      return () => window.clearInterval(refreshTimer);
    } else {
      setLeads([]);
      knownLeadIdsRef.current = null;
    }
  }, [user, fetchCrmLeads]);

  // Conexión WebSocket en tiempo real (/ws/crm-events) para alertas instantáneas de Captación Web
  useEffect(() => {
    if (!user) return;

    let disposed = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: number | null = null;

    const connectWs = () => {
      if (disposed) return;
      ws = new WebSocket(websocketUrl('/ws/crm-events'));
      ws.onopen = () => {
        const token = getAdminToken();
        if (token) ws?.send(JSON.stringify({ type: 'AUTH', token }));
        else ws?.close();
      };

      ws.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data) as {
            type?: string;
            lead?: LeadRecordDTO;
            leadId?: number;
          };

          if (parsed.type === 'NEW_WEB_LEAD' && parsed.lead) {
            const newLead = parsed.lead;
            if (knownLeadIdsRef.current) {
              knownLeadIdsRef.current.add(newLead.id);
            }
            setLeads((prev) => {
              const exists = prev.some((l) => l.id === newLead.id);
              if (exists) {
                return prev.map((l) => (l.id === newLead.id ? newLead : l));
              }
              return [newLead, ...prev];
            });
            triggerNewWebLeadAlert(newLead);
          } else if (parsed.type === 'LEAD_DELETED' && typeof parsed.leadId === 'number') {
            const removedId = parsed.leadId;
            setLeads((prev) => prev.filter((l) => l.id !== removedId));
            setSelectedLeadId((curr) => (curr === removedId ? null : curr));
          }
        } catch {
          // ignore malformed ws message
        }
      };

      ws.onclose = () => {
        if (!disposed) {
          reconnectTimer = window.setTimeout(connectWs, 4000);
        }
      };
    };

    connectWs();

    return () => {
      disposed = true;
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
      }
      if (ws) {
        try {
          ws.close();
        } catch {
          // ignore
        }
      }
    };
  }, [user, getAdminToken, triggerNewWebLeadAlert]);

  const selectedLead = useMemo(
    () => leads.find((l) => l.id === selectedLeadId) || null,
    [leads, selectedLeadId]
  );

  // Clientes en estado 'Nuevo' ordenados por Fecha y Hora exacta (más recientes primero)
  const newClientsList = useMemo(() => {
    return leads
      .filter((l) => l.status === 'Nuevo')
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [leads]);

  // Filtrado y Ordenamiento por Fecha y Hora (por defecto más recientes primero)
  const filteredAndSortedLeads = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    const filtered = leads.filter((lead) => {
      if (categoryFilter !== 'todos' && lead.interestType !== categoryFilter) {
        return false;
      }
      if (statusFilter !== 'Todos' && lead.status !== statusFilter) {
        return false;
      }
      if (q) {
        const vehicleStr = lead.vehicleRequest
          ? `${lead.vehicleRequest.brand} ${lead.vehicleRequest.model} ${lead.vehicleRequest.year}`
          : '';
        const haystack =
          `${lead.firstName} ${lead.lastName} ${lead.cedula} ${lead.phone} ${lead.city} ${lead.email} ${vehicleStr}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });

    return [...filtered].sort((a, b) => {
      if (sortMode === 'datetime_asc') {
        const diff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        if (diff !== 0) return diff;
        return a.id - b.id;
      }
      if (sortMode === 'call_asc') {
        const timeA = a.nextCallAt ? new Date(a.nextCallAt).getTime() : Number.POSITIVE_INFINITY;
        const timeB = b.nextCallAt ? new Date(b.nextCallAt).getTime() : Number.POSITIVE_INFINITY;
        if (timeA !== timeB) return timeA - timeB;
      }
      // Por defecto: 'datetime_desc' -> Fecha y Hora más recientes primero
      const diffDesc = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      if (diffDesc !== 0) return diffDesc;
      return b.id - a.id;
    });
  }, [leads, categoryFilter, statusFilter, sortMode, searchQuery]);

  // Métricas resumidas reales de la cartera
  const metrics = useMemo(() => {
    const vehiculos = leads.filter((l) => l.interestType === 'vehiculo');
    const motos = leads.filter((l) => l.interestType === 'moto');
    const inmuebles = leads.filter((l) => l.interestType === 'inmueble');
    const scheduledCalls = leads.filter((l) => Boolean(l.nextCallAt)).length;
    const totalCapital = leads.reduce((acc, l) => acc + (Number(l.availableAmount) || 0), 0);
    return {
      total: leads.length,
      newCount: newClientsList.length,
      vehiculosCount: vehiculos.length,
      motosCount: motos.length,
      inmueblesCount: inmuebles.length,
      scheduledCalls,
      totalCapital,
    };
  }, [leads, newClientsList.length]);

  // Handlers de mutación contra Cloud SQL
  const replaceLeadInState = (updated: LeadRecordDTO) => {
    setLeads((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
  };

  const handleUpdateLead = async (
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
  ) => {
    const res = await authFetch(`/api/crm/leads/${leadId}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al actualizar el cliente.');
    replaceLeadInState(data as LeadRecordDTO);
  };

  const handleConfirmDeleteLead = async (leadId: number) => {
    const res = await authFetch(`/api/crm/leads/${leadId}`, {
      method: 'DELETE',
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'No se pudo eliminar el cliente de la base de datos.');
    }

    const deletedName = data.clientName || `Expediente #${leadId}`;
    setLeads((prev) => prev.filter((item) => item.id !== leadId));
    setNewWebLeadAlerts((prev) => prev.filter((a) => a.lead.id !== leadId));
    if (selectedLeadId === leadId) {
      setSelectedLeadId(null);
    }
    setLeadPendingDelete(null);
    showTemporaryFeedback(
      `Confirmado: El cliente ${deletedName} (#${leadId}) fue eliminado permanentemente de la base de datos.`
    );
  };

  const handleAddActivity = async (
    leadId: number,
    payload: {
      activityType: ActivityType;
      title: string;
      description: string;
      scheduledAt?: string | null;
      reminderEnabled?: boolean;
      completed?: boolean;
    }
  ) => {
    const res = await authFetch(`/api/crm/leads/${leadId}/activities`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al registrar actividad.');
    replaceLeadInState(data as LeadRecordDTO);
  };

  const handleToggleActivity = async (activityId: number, completed: boolean) => {
    const res = await authFetch(`/api/crm/activities/${activityId}`, {
      method: 'PATCH',
      body: JSON.stringify({ completed }),
    });
    if (res.ok) {
      await fetchCrmLeads(true);
    }
  };

  const handleCompleteActivityFromReminder = useCallback(
    async (activityId: number) => {
      await handleToggleActivity(activityId, true);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [authFetch, fetchCrmLeads]
  );

  const {
    permission: notificationPermission,
    syncPermissionState,
    requestPermission: requestNotificationPermission,
    sendTestNotification,
    activeAlerts,
    dismissAlert,
    markAlertCompleted,
  } = useActivityReminders({
    enabled: Boolean(user),
    leads,
    onOpenLead: handleOpenLeadFromNotification,
    onCompleteActivity: handleCompleteActivityFromReminder,
  });

  const handleSendSms = async (leadId: number, phone: string, message: string) => {
    const res = await authFetch(`/api/crm/leads/${leadId}/sms`, {
      method: 'POST',
      body: JSON.stringify({ phone, message }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al despachar SMS.');
    if (data.lead) {
      replaceLeadInState(data.lead as LeadRecordDTO);
    }
  };

  const handleUploadAttachment = async (
    leadId: number,
    payload: {
      fileName: string;
      mimeType: string;
      fileSize: number;
      dataUrl: string;
      caption?: string;
    }
  ) => {
    const res = await authFetch(`/api/crm/leads/${leadId}/attachments`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al subir archivo.');
    replaceLeadInState(data as LeadRecordDTO);
  };

  const handleDeleteAttachment = async (attachmentId: number) => {
    const res = await authFetch(`/api/crm/attachments/${attachmentId}`, {
      method: 'DELETE',
    });
    if (res.ok) {
      await fetchCrmLeads(true);
    }
  };

  const handleSaveCalculatorSettings = async (next: CalculatorSettingsDTO) => {
    const res = await authFetch('/api/crm/calculator-settings', {
      method: 'PUT',
      body: JSON.stringify(next),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo actualizar la calculadora.');
    setCalculatorSettings(data as CalculatorSettingsDTO);
  };

  const handleSaveAdvisorProfile = async (
    next: Partial<AdvisorProfileDTO>
  ): Promise<AdvisorProfileDTO> => {
    const res = await authFetch('/api/crm/advisor-profile', {
      method: 'PUT',
      body: JSON.stringify(next),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'No se pudo actualizar el portal y perfil del asesor.');
    }
    const saved = data as AdvisorProfileDTO;
    setAdvisorProfile(saved);
    return saved;
  };

  const handleSendConfirmationEmail = async (leadId: number): Promise<string> => {
    const res = await authFetch(`/api/crm/leads/${leadId}/send-confirmation-email`, {
      method: 'POST',
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(
        data.error ||
          'No se pudo despachar el correo automático. Configure el remitente SMTP en Portal y Calculadora.'
      );
    }
    if (data.lead) {
      replaceLeadInState(data.lead as LeadRecordDTO);
    }
    return data.emailDelivery?.message || 'Correo de confirmación enviado exitosamente al cliente.';
  };

  const scrollToEmbeddedCalculator = () => {
    const el = document.getElementById('calculadora-captacion-web');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const handleApplyInitialFromPublicCalc = (initialAmount: number, planName: string) => {
    setPrefillFormAmount(initialAmount);
    const formEl = document.getElementById('formulario-captacion-web');
    if (formEl) {
      formEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    showTemporaryFeedback(
      `Se cargó la inicial de $${initialAmount.toLocaleString('en-US', {
        minimumFractionDigits: 2,
      })} (${planName}) en el formulario de solicitud.`
    );
  };

  const isPublicPortalView = activeSection === 'captacion';

  const renderAdminLoginScreen = () => (
    <div className="no-print max-w-md mx-auto my-8 bg-white rounded-xl border border-slate-200 p-8 space-y-5">
      <div className="flex items-center justify-between gap-4">
        <div className="w-10 h-10 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-800">
          <Lock className="w-5 h-5" />
        </div>
        <button
          type="button"
          onClick={() => {
            clearAuthError();
            setActiveSection('captacion');
          }}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
        >
          <X className="w-3.5 h-3.5" />
          <span>Cerrar</span>
        </button>
      </div>

      <div className="space-y-1">
        <h1 className="text-xl font-bold text-slate-900">Acceso de Personal Autorizado</h1>
        <p className="text-xs text-slate-500">
          Uso exclusivo para asesores y administradores de Autofin Venezuela.
        </p>
      </div>

      {authError && (
        <div className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-xs font-medium text-red-800">
          {authError}
        </div>
      )}

      <form onSubmit={handleCredentialLoginSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">
            Usuario o Correo de Acceso *
          </label>
          <input
            type="text"
            required
            autoComplete="username"
            value={loginIdentifier}
            onChange={(e) => {
              if (authError) clearAuthError();
              setLoginIdentifier(e.target.value);
            }}
            placeholder="Ingrese su usuario o correo"
            className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-600"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">
            Clave de Acceso *
          </label>
          <div className="relative">
            <input
              type={showLoginPassword ? 'text' : 'password'}
              required
              autoComplete="current-password"
              value={loginPassword}
              onChange={(e) => {
                if (authError) clearAuthError();
                setLoginPassword(e.target.value);
              }}
              placeholder="Ingrese su clave"
              className="w-full pl-3.5 pr-10 py-2.5 text-sm font-mono rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-600"
            />
            <button
              type="button"
              onClick={() => setShowLoginPassword((v) => !v)}
              aria-label="Mostrar u ocultar clave"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
            >
              {showLoginPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <div className="pt-1">
          <button
            type="submit"
            disabled={submittingLogin}
            className="w-full px-5 py-2.5 text-sm font-semibold text-white bg-sky-700 rounded-lg hover:bg-sky-800 disabled:opacity-60 transition-colors"
          >
            {submittingLogin ? 'Verificando acceso...' : 'Iniciar Sesión'}
          </button>
        </div>
      </form>
    </div>
  );

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900 print:bg-white">
      {/* Top Bar Contract: Exactamente 3 zonas separadas por gap-8 (oculta al imprimir reportes) */}
      <header className="no-print bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between gap-8 sticky top-0 z-30">
        {/* Zona 1: Wordmark Autofin Venezuela */}
        <button
          type="button"
          onClick={() => setActiveSection('captacion')}
          className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 cursor-pointer"
        >
          Autofin Venezuela
        </button>

        {/* Zona 2: Enlaces según contexto (Inicio Público vs Panel Administrativo) */}
        {isPublicPortalView ? (
          <nav className="flex items-center gap-6 text-sm font-medium text-slate-600 overflow-x-auto">
            <button
              type="button"
              onClick={() => {
                setActiveSection('captacion');
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className="py-0.5 transition-colors whitespace-nowrap shrink-0 border-b-2 text-slate-900 border-sky-700 font-semibold"
            >
              Captación Web
            </button>
            <button
              type="button"
              onClick={scrollToEmbeddedCalculator}
              className="py-0.5 transition-colors whitespace-nowrap shrink-0 border-b-2 border-transparent hover:text-slate-900 hover:border-slate-300"
            >
              Calculadora
            </button>
            <button
              type="button"
              onClick={() => setAssistantOpen(true)}
              className="py-0.5 transition-colors whitespace-nowrap shrink-0 border-b-2 border-transparent hover:text-slate-900 hover:border-slate-300"
            >
              Asistente de IA
            </button>
          </nav>
        ) : (
          <nav className="flex items-center gap-6 text-sm font-medium text-slate-600 overflow-x-auto">
            {[
              { id: 'crm', label: 'Dashboard CRM' },
              {
                id: 'nuevos',
                label:
                  user && newClientsList.length > 0
                    ? `Clientes Nuevos (${newClientsList.length})`
                    : 'Clientes Nuevos',
              },
              { id: 'resumen', label: 'Resumen Mensual' },
              { id: 'portal', label: 'Portal y Calculadora' },
              { id: 'admins', label: 'Administradores' },
              { id: 'esquema', label: 'Esquema SQL' },
              { id: 'captacion', label: 'Captación Web' },
            ].map((navItem) => {
              const active = activeSection === navItem.id;
              return (
                <button
                  key={navItem.id}
                  type="button"
                  onClick={() => setActiveSection(navItem.id as ActiveSection)}
                  className={`py-0.5 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
                    active
                      ? 'text-slate-900 border-sky-700 font-semibold'
                      : 'border-transparent hover:text-slate-900 hover:border-slate-300'
                  }`}
                >
                  {navItem.label}
                </button>
              );
            })}
          </nav>
        )}

        {/* Zona 3: 1 acción primaria (En Inicio: Acceso de Asesor | En Panel Administrativo: Cerrar Sesión o Cerrar) */}
        <div className="flex items-center shrink-0">
          {isPublicPortalView ? (
            <button
              type="button"
              onClick={() => setActiveSection(user && newClientsList.length > 0 ? 'nuevos' : 'crm')}
              className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
            >
              {user
                ? newClientsList.length > 0
                  ? `Panel Administrativo (${newClientsList.length} nuevos)`
                  : 'Panel Administrativo'
                : 'Acceso de Asesor'}
            </button>
          ) : user ? (
            <button
              type="button"
              onClick={handleFullSignOut}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-red-700 rounded-lg hover:bg-red-800 transition-colors whitespace-nowrap shrink-0"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Cerrar Sesión</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setActiveSection('captacion')}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-slate-800 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors whitespace-nowrap shrink-0"
            >
              <X className="w-3.5 h-3.5" />
              <span>Cerrar</span>
            </button>
          )}
        </div>
      </header>

      {/* Banner Global de Confirmación Operativa (ej. Confirmación tras eliminar cliente) */}
      {actionFeedback && (
        <div className="no-print max-w-7xl w-full mx-auto px-6 pt-4">
          <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-medium text-emerald-900 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
              <span>{actionFeedback}</span>
            </div>
            <button
              type="button"
              onClick={() => setActionFeedback(null)}
              className="font-semibold text-emerald-800 hover:text-emerald-950 shrink-0"
            >
              Cerrar
            </button>
          </div>
        </div>
      )}

      {/* Contenido Principal */}
      <main className="flex-1">
        {activeSection === 'captacion' && (
          <div className="pb-12 space-y-4">
            {/* 1. Formulario de Captación Web con Perfil y Foto de Jesús Artahona */}
            <PublicLeadForm
              mode="public"
              prefillAmount={prefillFormAmount}
              advisorProfile={advisorProfile}
              onLeadSubmitted={(createdLead) => {
                if (user) {
                  setLeads((prev) => {
                    if (prev.some((l) => l.id === createdLead.id)) return prev;
                    return [createdLead, ...prev];
                  });
                  triggerNewWebLeadAlert(createdLead);
                }
              }}
              onOpenAssistant={() => setAssistantOpen(true)}
              onScrollToCalculator={scrollToEmbeddedCalculator}
            />

            {/* 2. Calculadora de Financiamiento Integrada dentro de Captación Web */}
            <section
              id="calculadora-captacion-web"
              className="max-w-7xl mx-auto px-6 pt-2 space-y-4 scroll-mt-24"
            >
              <div className="border-t border-slate-200 pt-8">
                <h2 className="text-xl font-bold text-slate-900">
                  Simulador de Planes y Cuotas Autofin Venezuela
                </h2>
                <p className="text-sm text-slate-600 mt-1">
                  Calcula las opciones de Entrega Garantizada, Plan Promocional, Plan Ahorro y
                  Entrega Rápida para el monto de tu vehículo, moto o inmueble antes de enviar tu
                  solicitud con {advisorProfile.advisorName}.
                </p>
              </div>

              <FinancingCalculator
                settings={calculatorSettings}
                canConfigure={false}
                onApplyInitialToForm={handleApplyInitialFromPublicCalc}
              />
            </section>
          </div>
        )}

        {/* SECCIÓN DEDICADA: CLIENTES NUEVOS (Captación Web y Pendientes de Primer Contacto) */}
        {activeSection === 'nuevos' && (
          <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
            {authLoading ? (
              <div className="bg-white rounded-xl border border-slate-200 p-10 text-center text-sm text-slate-500">
                Verificando credenciales del panel administrativo...
              </div>
            ) : !user ? (
              renderAdminLoginScreen()
            ) : (
              <>
                <div className="bg-white rounded-xl border border-slate-200 p-6 flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-start gap-3.5">
                    <div className="w-10 h-10 rounded-lg bg-sky-50 border border-sky-200 flex items-center justify-center text-sky-700 shrink-0">
                      <BellRing className="w-5 h-5" />
                    </div>
                    <div>
                      <h1 className="text-xl font-bold text-slate-900">
                        Bandeja de Clientes Nuevos — Captación Web ({newClientsList.length})
                      </h1>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Solicitudes entrantes pendientes de primer contacto, ordenadas por fecha y
                        hora exacta de registro.
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const sample: LeadRecordDTO =
                          newClientsList[0] ||
                          leads[0] || {
                            id: 999,
                            firstName: 'Carlos Eduardo',
                            lastName: 'Mendoza',
                            cedula: 'V-19.482.110',
                            phone: '+58 414-321-8890',
                            email: 'cmendoza@correo.ve',
                            city: 'Valencia',
                            availableAmount: '3800.00',
                            interestType: 'vehiculo',
                            status: 'Nuevo',
                            nextCallAt: new Date().toISOString(),
                            assignedAdvisorUid: null,
                            source: 'Formulario Web',
                            createdAt: new Date().toISOString(),
                            updatedAt: new Date().toISOString(),
                            vehicleRequest: {
                              id: 1,
                              leadId: 999,
                              condition: 'Nuevo',
                              year: 2026,
                              brand: 'Livan',
                              model: 'X3 Pro Automático',
                              estimatedTotalAmount: '25080.00',
                              selectedPlan: null,
                              createdAt: new Date().toISOString(),
                            },
                          };
                        triggerNewWebLeadAlert(sample, true);
                      }}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-sky-800 bg-sky-50 border border-sky-200 rounded-lg hover:bg-sky-100 transition-colors whitespace-nowrap shrink-0"
                    >
                      <BellRing className="w-3.5 h-3.5 text-sky-700" />
                      <span>Probar Alerta de Cliente Nuevo</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => fetchCrmLeads(false)}
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>Actualizar</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setActiveSection('crm')}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-800 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors whitespace-nowrap shrink-0"
                    >
                      <X className="w-3.5 h-3.5" />
                      <span>Ir al Dashboard CRM</span>
                    </button>
                  </div>
                </div>

                {newClientsList.length === 0 ? (
                  <div className="bg-white rounded-xl border border-slate-200 p-12 text-center space-y-3">
                    <UserCheck className="w-8 h-8 text-emerald-600 mx-auto" />
                    <p className="text-sm font-bold text-slate-900">
                      Todos los clientes nuevos han sido atendidos
                    </p>
                    <p className="text-xs text-slate-500 max-w-md mx-auto">
                      Cuando un visitante complete el formulario en Captación Web, aparecerá
                      automáticamente aquí y recibirás una alerta sonora y en pantalla.
                    </p>
                    <button
                      type="button"
                      onClick={() => setActiveSection('crm')}
                      className="px-4 py-2 text-xs font-semibold text-white bg-sky-700 rounded-lg hover:bg-sky-800"
                    >
                      Ver Cartera Completa en Dashboard CRM
                    </button>
                  </div>
                ) : (
                  <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-200 overflow-hidden">
                    {newClientsList.map((lead) => {
                      const { datePart, timePart } = formatRegistrationDate(lead.createdAt);
                      const waUrl = `https://wa.me/${sanitizePhoneForWhatsApp(lead.phone)}`;
                      const detail =
                        (lead.interestType === 'vehiculo' || lead.interestType === 'moto') &&
                        lead.vehicleRequest
                          ? `${lead.interestType === 'moto' ? 'Moto' : 'Vehículo'} ${lead.vehicleRequest.condition}: ${lead.vehicleRequest.brand} ${lead.vehicleRequest.model} (${lead.vehicleRequest.year})`
                          : 'Financiamiento de Inmueble (Propiedad vista confirmada)';

                      return (
                        <div
                          key={lead.id}
                          className="p-5 hover:bg-slate-50 transition-colors flex flex-wrap items-center justify-between gap-4"
                        >
                          <div className="space-y-1.5 min-w-0">
                            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                              <span className="inline-flex items-center gap-1 font-mono tabular-nums font-semibold text-sky-800">
                                <Clock className="w-3.5 h-3.5" />
                                {datePart} · {timePart}
                              </span>
                              <span aria-hidden="true">·</span>
                              <span className="font-mono tabular-nums">Expediente #{lead.id}</span>
                              <span aria-hidden="true">·</span>
                              <span className="font-medium text-slate-700">
                                Origen: {lead.source}
                              </span>
                              <span aria-hidden="true">·</span>
                              <span>{lead.city}</span>
                            </div>

                            <div className="text-base font-bold text-slate-900">
                              {lead.firstName} {lead.lastName}{' '}
                              <span className="text-xs font-normal font-mono tabular-nums text-slate-500">
                                ({lead.cedula} · {lead.phone})
                              </span>
                            </div>

                            <div className="text-xs text-slate-700">
                              {detail} · Inicial disponible:{' '}
                              <strong className="font-mono tabular-nums text-slate-900">
                                ${Number(lead.availableAmount).toLocaleString('en-US', {
                                  minimumFractionDigits: 2,
                                })}
                              </strong>
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={async () => {
                                await handleUpdateLead(lead.id, { status: 'Contactado' });
                                showTemporaryFeedback(
                                  `${lead.firstName} ${lead.lastName} pasó a estado Contactado.`
                                );
                              }}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 transition-colors whitespace-nowrap"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>Marcar Contactado</span>
                            </button>

                            <a
                              href={waUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-700 rounded-lg hover:bg-emerald-800 transition-colors whitespace-nowrap"
                            >
                              <MessageCircle className="w-3.5 h-3.5" />
                              <span>WhatsApp</span>
                            </a>

                            <a
                              href={`tel:${lead.phone.replace(/\s+/g, '')}`}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-sky-700 rounded-lg hover:bg-sky-800 transition-colors whitespace-nowrap"
                            >
                              <Phone className="w-3.5 h-3.5" />
                              <span>Llamar</span>
                            </a>

                            <button
                              type="button"
                              onClick={() => setSelectedLeadId(lead.id)}
                              className="px-3 py-1.5 text-xs font-semibold text-slate-800 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors whitespace-nowrap"
                            >
                              Abrir Ficha
                            </button>

                            <button
                              type="button"
                              onClick={() => setLeadPendingDelete(lead)}
                              title="Eliminar cliente de la base de datos"
                              className="p-2 text-slate-400 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* SECCIÓN DEDICADA: RESUMEN MENSUAL Y ANUAL IMPRIMIBLE */}
        {activeSection === 'resumen' && (
          <div className="max-w-7xl mx-auto px-6 py-8 print:max-w-none print:px-0 print:py-0">
            {authLoading ? (
              <div className="bg-white rounded-xl border border-slate-200 p-10 text-center text-sm text-slate-500">
                Verificando credenciales del panel administrativo...
              </div>
            ) : !user ? (
              renderAdminLoginScreen()
            ) : (
              <MonthlyAnnualReportPanel
                leads={leads}
                advisorProfile={advisorProfile}
                onSelectLead={(id) => setSelectedLeadId(id)}
                onClose={() => setActiveSection('crm')}
              />
            )}
          </div>
        )}

        {/* SECCIÓN DEDICADA: PERSONALIZAR PORTAL (HERO, SEDE VALENCIA, CALCULADORA Y CORREO SMTP) */}
        {activeSection === 'portal' && (
          <div className="max-w-7xl mx-auto px-6 py-8">
            {authLoading ? (
              <div className="bg-white rounded-xl border border-slate-200 p-10 text-center text-sm text-slate-500">
                Verificando credenciales del panel administrativo...
              </div>
            ) : !user ? (
              renderAdminLoginScreen()
            ) : (
              <PortalSettingsPanel
                isAdmin={isAdmin}
                advisorProfile={advisorProfile}
                calculatorSettings={calculatorSettings}
                authFetch={authFetch}
                onSaveAdvisorProfile={handleSaveAdvisorProfile}
                onSaveCalculatorSettings={handleSaveCalculatorSettings}
                onClose={() => setActiveSection('crm')}
              />
            )}
          </div>
        )}

        {activeSection === 'esquema' && (
          <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
            {authLoading ? (
              <div className="bg-white rounded-xl border border-slate-200 p-10 text-center text-sm text-slate-500">
                Verificando credenciales del panel administrativo...
              </div>
            ) : !user ? (
              renderAdminLoginScreen()
            ) : (
              <>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-xs font-medium text-slate-500">
                    Panel Administrativo · Documentación Técnica de Base de Datos
                  </span>
                  <button
                    type="button"
                    onClick={() => setActiveSection('crm')}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-slate-800 bg-white border border-slate-200 rounded-lg hover:bg-slate-50"
                  >
                    <X className="w-3.5 h-3.5" />
                    <span>Cerrar</span>
                  </button>
                </div>
                <DatabaseSchemaView />
              </>
            )}
          </div>
        )}

        {activeSection === 'admins' && (
          <div className="max-w-7xl mx-auto px-6 py-8">
            {authLoading ? (
              <div className="bg-white rounded-xl border border-slate-200 p-10 text-center text-sm text-slate-500">
                Verificando sesión de administrador...
              </div>
            ) : !user ? (
              renderAdminLoginScreen()
            ) : !isAdmin ? (
              <div className="max-w-4xl mx-auto space-y-6">
                <AdvisorProfileEditor
                  profile={advisorProfile}
                  onSaveProfile={handleSaveAdvisorProfile}
                />
                <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
                  <h2 className="text-base font-bold text-slate-900">
                    Creación de Claves Reservada a Administradores
                  </h2>
                  <p className="text-sm text-slate-600">
                    Su cuenta tiene rol de Asesor Comercial. Puede actualizar la foto pública del
                    asesor arriba o regresar al Dashboard CRM.
                  </p>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setActiveSection('crm')}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-slate-800 bg-slate-100 rounded-lg hover:bg-slate-200"
                    >
                      <X className="w-3.5 h-3.5" />
                      <span>Cerrar</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleFullSignOut}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-red-700 rounded-lg hover:bg-red-800"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>Cerrar Sesión</span>
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <AdminManagementPanel
                currentUser={user}
                advisorProfile={advisorProfile}
                onSaveAdvisorProfile={handleSaveAdvisorProfile}
                authFetch={authFetch}
                onClosePanel={() => setActiveSection('crm')}
                onSignOut={handleFullSignOut}
              />
            )}
          </div>
        )}

        {activeSection === 'crm' && (
          <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
            {authLoading ? (
              <div className="bg-white rounded-xl border border-slate-200 p-10 text-center text-sm text-slate-500">
                Verificando credenciales del asesor...
              </div>
            ) : !user ? (
              renderAdminLoginScreen()
            ) : (
              /* Dashboard Operativo del CRM (Panel Administrativo) */
              <>
                {/* Barra de Contexto del Asesor y Acciones del Dashboard */}
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-3.5">
                    <img
                      src={advisorProfile.photoUrl}
                      alt={advisorProfile.advisorName}
                      className="w-12 h-12 rounded-full object-cover bg-white border border-slate-200 shrink-0"
                    />
                    <div>
                      <h1 className="text-2xl font-bold text-slate-900">
                        Dashboard CRM — Panel Administrativo
                      </h1>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Asesor titular:{' '}
                        <strong className="text-slate-800">{advisorProfile.advisorName}</strong> ·
                        Sesión: {user.displayName || user.email} ({getRoleBadgeText(user.role)})
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <ReminderToolbarControl
                      leads={leads}
                      permission={notificationPermission}
                      onRequestPermission={requestNotificationPermission}
                      onSendTestNotification={sendTestNotification}
                    />

                    <button
                      type="button"
                      onClick={() => setActiveSection('resumen')}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
                    >
                      <Printer className="w-3.5 h-3.5 text-sky-700" />
                      <span>Resumen Mensual / Imprimir</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setActiveSection('portal')}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
                    >
                      <Camera className="w-3.5 h-3.5 text-sky-700" />
                      <span>Hero, Sede y Correo</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setShowAdminCalcConfigModal((v) => !v)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
                    >
                      <Calculator className="w-3.5 h-3.5 text-sky-700" />
                      <span>Configurar Calculadora</span>
                    </button>

                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => setActiveSection('admins')}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
                      >
                        <KeyRound className="w-3.5 h-3.5 text-sky-700" />
                        <span>Claves de Admin</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => setAssistantOpen(true)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-sky-700 rounded-lg hover:bg-sky-800 transition-colors whitespace-nowrap shrink-0"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>Asistente IA</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setShowNewLeadModal(true)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Registrar Prospecto</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => fetchCrmLeads(false)}
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>Actualizar</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setActiveSection('captacion')}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-800 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors whitespace-nowrap shrink-0"
                    >
                      <X className="w-3.5 h-3.5" />
                      <span>Cerrar</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleFullSignOut}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-red-700 bg-white border border-red-200 rounded-lg hover:bg-red-50 transition-colors whitespace-nowrap shrink-0"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>Cerrar Sesión</span>
                    </button>
                  </div>
                </div>

                {/* Aviso destacado si existen Clientes Nuevos sin atender desde Captación Web */}
                {newClientsList.length > 0 && (
                  <div className="bg-sky-50 border border-sky-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-center gap-3 text-xs sm:text-sm text-slate-800">
                      <BellRing className="w-4 h-4 text-sky-700 shrink-0" />
                      <span>
                        Tienes{' '}
                        <strong className="font-mono tabular-nums text-slate-900">
                          {newClientsList.length}
                        </strong>{' '}
                        {newClientsList.length === 1
                          ? 'cliente nuevo pendiente de primer contacto.'
                          : 'clientes nuevos pendientes de primer contacto.'}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveSection('nuevos')}
                      className="px-3.5 py-1.5 text-xs font-semibold text-white bg-sky-700 rounded-lg hover:bg-sky-800 transition-colors whitespace-nowrap shrink-0"
                    >
                      Abrir Sección Clientes Nuevos
                    </button>
                  </div>
                )}

                {/* Panel Desplegable Rápido: Cambiar Foto de Jesús Artahona (<= 200 KB) */}
                {showAdvisorPhotoModal && (
                  <div className="space-y-2">
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => setShowAdvisorPhotoModal(false)}
                        className="inline-flex items-center gap-1 px-3 py-1 text-xs font-semibold text-slate-600 hover:text-slate-900"
                      >
                        <X className="w-3.5 h-3.5" />
                        <span>Cerrar editor de foto</span>
                      </button>
                    </div>
                    <AdvisorProfileEditor
                      profile={advisorProfile}
                      onSaveProfile={handleSaveAdvisorProfile}
                    />
                  </div>
                )}

                {/* Panel Desplegable Rápido: Calculadora y Configuración de Tasas del Asesor */}
                {showAdminCalcConfigModal && (
                  <div className="space-y-2">
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => setShowAdminCalcConfigModal(false)}
                        className="inline-flex items-center gap-1 px-3 py-1 text-xs font-semibold text-slate-600 hover:text-slate-900"
                      >
                        <X className="w-3.5 h-3.5" />
                        <span>Cerrar calculadora</span>
                      </button>
                    </div>
                    <FinancingCalculator
                      settings={calculatorSettings}
                      canConfigure={true}
                      defaultOpenConfig={true}
                      onSaveSettings={handleSaveCalculatorSettings}
                    />
                  </div>
                )}

                {/* Franja de Indicadores Clave (4 columnas, elevación única, tabular-nums) */}
                <div className="bg-white rounded-xl border border-slate-200 grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-slate-200">
                  <div className="p-5">
                    <p className="text-xs text-slate-500 font-medium">Total Clientes en Cartera</p>
                    <p className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">
                      {metrics.total}
                    </p>
                    <p className="text-xs text-slate-500 mt-1">
                      <span className="font-mono tabular-nums">{metrics.newCount}</span> en estado
                      Nuevo
                    </p>
                  </div>
                  <div className="p-5">
                    <p className="text-xs text-slate-500 font-medium">Vehículos y Motos</p>
                    <p className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">
                      {metrics.vehiculosCount + metrics.motosCount}
                    </p>
                    <p className="text-xs text-slate-500 mt-1">
                      <span className="font-mono tabular-nums">{metrics.vehiculosCount}</span>{' '}
                      vehículos ·{' '}
                      <span className="font-mono tabular-nums">{metrics.motosCount}</span> motos
                    </p>
                  </div>
                  <div className="p-5">
                    <p className="text-xs text-slate-500 font-medium">Solicitudes de Inmuebles</p>
                    <p className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">
                      {metrics.inmueblesCount}
                    </p>
                    <p className="text-xs text-slate-500 mt-1">Viviendas y galpones vistos</p>
                  </div>
                  <div className="p-5">
                    <p className="text-xs text-slate-500 font-medium">
                      Capital Inicial Declarado
                    </p>
                    <p className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">
                      ${metrics.totalCapital.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                    </p>
                    <p className="text-xs text-slate-500 mt-1">
                      <span className="font-mono tabular-nums">{metrics.scheduledCalls}</span>{' '}
                      llamadas agendadas
                    </p>
                  </div>
                </div>

                {/* Barra de Filtrado y Ordenamiento por Fecha y Hora */}
                <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-wrap items-center justify-between gap-4">
                  <div className="flex flex-wrap items-center gap-3">
                    {/* Filtro Categoría */}
                    <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                      {[
                        { id: 'todos', label: 'Todas las Verticales' },
                        { id: 'vehiculo', label: 'Vehículos' },
                        { id: 'moto', label: 'Motos' },
                        { id: 'inmueble', label: 'Inmuebles' },
                      ].map((tab) => (
                        <button
                          key={tab.id}
                          type="button"
                          onClick={() => setCategoryFilter(tab.id as 'todos' | InterestType)}
                          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                            categoryFilter === tab.id
                              ? 'bg-white text-slate-900 shadow-sm'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>

                    {/* Filtro Estado del Lead */}
                    <select
                      value={statusFilter}
                      onChange={(e) => setStatusFilter(e.target.value as 'Todos' | LeadStatus)}
                      className="px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-600"
                    >
                      <option value="Todos">Estado: Todos</option>
                      <option value="Nuevo">Nuevo</option>
                      <option value="Contactado">Contactado</option>
                      <option value="Cita Presencial">Cita Presencial</option>
                      <option value="En Financiamiento">En Financiamiento</option>
                      <option value="Cerrado">Cerrado</option>
                      <option value="Perdido">Perdido</option>
                    </select>

                    {/* Selector explícito de Ordenamiento por Fecha y Hora */}
                    <select
                      value={sortMode}
                      onChange={(e) => setSortMode(e.target.value as LeadSortMode)}
                      className="px-3 py-2 text-xs font-semibold text-slate-800 bg-slate-100 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-600"
                    >
                      <option value="datetime_desc">
                        Orden: Fecha y Hora (Más recientes primero)
                      </option>
                      <option value="datetime_asc">
                        Orden: Fecha y Hora (Más antiguos primero)
                      </option>
                      <option value="call_asc">
                        Orden: Próxima Llamada (Más próximas primero)
                      </option>
                    </select>
                  </div>

                  {/* Buscador en vivo */}
                  <div className="relative w-full sm:w-64">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Buscar cliente, cédula, modelo..."
                      className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-600"
                    />
                  </div>
                </div>

                {/* Tabla de Clientes / Leads Ordenada por Fecha y Hora */}
                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                  {leadsError && (
                    <div className="p-4 bg-red-50 border-b border-red-200 text-xs text-red-800 flex items-center justify-between">
                      <span>{leadsError}</span>
                      <button
                        type="button"
                        onClick={() => fetchCrmLeads(false)}
                        className="font-semibold underline"
                      >
                        Reintentar
                      </button>
                    </div>
                  )}

                  {loadingLeads ? (
                    <div className="divide-y divide-slate-200">
                      {[1, 2, 3, 4].map((skeleton) => (
                        <div key={skeleton} className="px-6 py-4 animate-pulse flex gap-6">
                          <div className="h-4 bg-slate-200 rounded w-1/5" />
                          <div className="h-4 bg-slate-200 rounded w-1/4" />
                          <div className="h-4 bg-slate-200 rounded w-1/4" />
                          <div className="h-4 bg-slate-200 rounded w-1/6" />
                        </div>
                      ))}
                    </div>
                  ) : filteredAndSortedLeads.length === 0 ? (
                    <div className="p-12 text-center space-y-3">
                      <p className="text-sm font-semibold text-slate-800">
                        No se encontraron clientes con los filtros seleccionados
                      </p>
                      <p className="text-xs text-slate-500 max-w-md mx-auto">
                        Puedes limpiar los criterios de búsqueda o registrar un nuevo prospecto
                        desde el formulario público o de asesor.
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setCategoryFilter('todos');
                          setStatusFilter('Todos');
                          setSearchQuery('');
                        }}
                        className="px-4 py-2 text-xs font-medium text-white bg-sky-700 rounded-lg hover:bg-sky-800"
                      >
                        Restablecer Filtros
                      </button>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                            <th className="py-3 px-5">Fecha y Hora</th>
                            <th className="py-3 px-4">Cliente / Identificación</th>
                            <th className="py-3 px-4">Vertical y Solicitud</th>
                            <th className="py-3 px-3">Ciudad</th>
                            <th className="py-3 px-4 text-right">Monto Disponible</th>
                            <th className="py-3 px-4">Próxima Llamada</th>
                            <th className="py-3 px-3">Estado</th>
                            <th className="py-3 px-5 text-right">Acciones</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 text-sm">
                          {filteredAndSortedLeads.map((lead) => {
                            const waLink = `https://wa.me/${sanitizePhoneForWhatsApp(lead.phone)}`;
                            const { datePart, timePart } = formatRegistrationDate(lead.createdAt);
                            return (
                              <tr
                                key={lead.id}
                                onClick={() => setSelectedLeadId(lead.id)}
                                className="hover:bg-slate-50 cursor-pointer transition-colors"
                              >
                                <td className="py-3.5 px-5 whitespace-nowrap">
                                  <div className="text-xs font-mono tabular-nums font-semibold text-slate-900">
                                    {datePart}
                                  </div>
                                  <div className="text-xs font-mono tabular-nums text-slate-500 mt-0.5">
                                    {timePart} · #{lead.id}
                                  </div>
                                </td>

                                <td className="py-3.5 px-4">
                                  <div className="font-semibold text-slate-900">
                                    {lead.firstName} {lead.lastName}
                                  </div>
                                  <div className="text-xs text-slate-500 font-mono tabular-nums mt-0.5">
                                    {lead.cedula} · {lead.phone}
                                  </div>
                                </td>

                                <td className="py-3.5 px-4">
                                  <div className="flex items-center gap-1.5 text-slate-900 font-medium">
                                    {lead.interestType === 'vehiculo' ? (
                                      <Car className="w-3.5 h-3.5 text-sky-700 shrink-0" />
                                    ) : lead.interestType === 'moto' ? (
                                      <Bike className="w-3.5 h-3.5 text-sky-700 shrink-0" />
                                    ) : (
                                      <Building2 className="w-3.5 h-3.5 text-sky-700 shrink-0" />
                                    )}
                                    <span>
                                      {(lead.interestType === 'vehiculo' ||
                                        lead.interestType === 'moto') &&
                                      lead.vehicleRequest
                                        ? `${lead.vehicleRequest.brand} ${lead.vehicleRequest.model}`
                                        : lead.propertyRequest?.propertyCategory ||
                                          'Inmueble Comercial / Vivienda'}
                                    </span>
                                  </div>
                                  <div className="text-xs text-slate-500 mt-0.5">
                                    {(lead.interestType === 'vehiculo' ||
                                      lead.interestType === 'moto') &&
                                    lead.vehicleRequest
                                      ? `${lead.interestType === 'moto' ? 'Moto' : 'Vehículo'} · ${lead.vehicleRequest.condition} · Año ${lead.vehicleRequest.year}`
                                      : 'Propiedad vista y monto confirmado'}
                                  </div>
                                </td>

                                <td className="py-3.5 px-3 text-xs font-medium text-slate-700 whitespace-nowrap">
                                  {lead.city}
                                </td>

                                <td className="py-3.5 px-4 text-right font-mono tabular-nums font-semibold text-slate-900 whitespace-nowrap">
                                  ${Number(lead.availableAmount).toLocaleString('en-US', {
                                    minimumFractionDigits: 2,
                                  })}
                                </td>

                                <td className="py-3.5 px-4 whitespace-nowrap">
                                  <div className="inline-flex items-center gap-1.5 text-xs font-mono tabular-nums text-slate-700">
                                    <CalendarClock className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                                    <span>{formatCallSchedule(lead.nextCallAt)}</span>
                                  </div>
                                </td>

                                <td className="py-3.5 px-3 text-xs font-semibold text-slate-800 whitespace-nowrap">
                                  {lead.status}
                                </td>

                                <td
                                  className="py-3.5 px-5 text-right whitespace-nowrap"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <div className="inline-flex items-center gap-1">
                                    <a
                                      href={waLink}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      title="Abrir chat de WhatsApp"
                                      className="p-2 rounded-lg text-emerald-700 hover:bg-emerald-50 transition-colors"
                                    >
                                      <MessageCircle className="w-4 h-4" />
                                    </a>
                                    <a
                                      href={`tel:${lead.phone.replace(/\s+/g, '')}`}
                                      title="Llamar al cliente"
                                      className="p-2 rounded-lg text-sky-700 hover:bg-sky-50 transition-colors"
                                    >
                                      <Phone className="w-4 h-4" />
                                    </a>
                                    <button
                                      type="button"
                                      onClick={() => setSelectedLeadId(lead.id)}
                                      className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
                                    >
                                      Ver Ficha
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setLeadPendingDelete(lead)}
                                      title="Eliminar cliente de la base de datos"
                                      className="p-2 rounded-lg text-slate-400 hover:text-red-700 hover:bg-red-50 transition-colors"
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </main>

      {/* Modal para Registro Rápido de Prospecto por el Asesor (Modo CRM limpio) */}
      {showNewLeadModal && (
        <div className="no-print fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-[1px] overflow-y-auto p-4 sm:p-8">
          <div className="max-w-3xl mx-auto bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden">
            <div className="px-6 py-4 bg-white border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">
                Registrar Nuevo Prospecto en Cartera (Ingreso Directo Asesor)
              </h3>
              <button
                type="button"
                onClick={() => setShowNewLeadModal(false)}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 hover:text-slate-900 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
                <span>Cerrar</span>
              </button>
            </div>
            <PublicLeadForm
              mode="crm"
              authFetch={authFetch}
              advisorProfile={advisorProfile}
              onLeadSubmitted={(created) => {
                if (knownLeadIdsRef.current) {
                  knownLeadIdsRef.current.add(created.id);
                }
                setLeads((prev) => [created, ...prev]);
                setShowNewLeadModal(false);
                showTemporaryFeedback(
                  `Prospecto ${created.firstName} ${created.lastName} registrado exitosamente en la cartera.`
                );
              }}
            />
          </div>
        </div>
      )}

      {/* Ficha Detallada del Cliente */}
      {selectedLead && (
        <LeadDetailDrawer
          lead={selectedLead}
          advisorProfile={advisorProfile}
          calculatorSettings={calculatorSettings}
          onClose={() => setSelectedLeadId(null)}
          onPermissionUpdated={syncPermissionState}
          onRequestDeleteLead={(leadToDelete) => setLeadPendingDelete(leadToDelete)}
          onSendConfirmationEmail={handleSendConfirmationEmail}
          onUpdateLead={handleUpdateLead}
          onAddActivity={handleAddActivity}
          onToggleActivity={handleToggleActivity}
          onSendSms={handleSendSms}
          onUploadAttachment={handleUploadAttachment}
          onDeleteAttachment={handleDeleteAttachment}
          onSaveCalculatorSettings={handleSaveCalculatorSettings}
        />
      )}

      {/* Modal de Confirmación para Eliminar Cliente de Cloud SQL PostgreSQL */}
      <ConfirmDeleteModal
        lead={leadPendingDelete}
        onCancel={() => setLeadPendingDelete(null)}
        onConfirmDelete={handleConfirmDeleteLead}
      />

      {/* Pila de Alertas Instantáneas de Cliente Nuevo en Captación Web */}
      <NewWebLeadToastStack
        alerts={newWebLeadAlerts}
        onOpenLead={handleOpenLeadFromNotification}
        onGoToNewClientsSection={() => setActiveSection('nuevos')}
        onDismiss={dismissNewWebLeadAlert}
      />

      {/* Pila de Alertas de Recordatorios de Llamadas y Citas */}
      <ReminderToastStack
        alerts={activeAlerts}
        onOpenLead={handleOpenLeadFromNotification}
        onDismiss={dismissAlert}
        onComplete={markAlertCompleted}
      />

      {/* Asistente de IA (Modo Cliente en Inicio Público / Modo Asesor en Panel Administrativo) */}
      <GeminiAdvisorPanel
        open={assistantOpen}
        onClose={() => setAssistantOpen(false)}
        activeLead={isPublicPortalView ? null : selectedLead}
        isAdvisorMode={Boolean(user && !isPublicPortalView)}
        advisorProfile={advisorProfile}
        authFetch={authFetch}
      />

      {/* Footer sobrio e institucional (oculto al imprimir reportes) */}
      <footer className="no-print bg-white border-t border-slate-200 px-6 py-4 text-xs text-slate-500 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <span>
            Autofin Venezuela — Sede Oficial:{' '}
            <strong className="text-slate-700 font-medium">
              {advisorProfile.officeAddress || OFFICIAL_OFFICE_ADDRESS}
            </strong>{' '}
            · Asesor: {advisorProfile.advisorName}
          </span>
        </div>
        <div className="flex items-center gap-4">
          {user && (
            <button
              type="button"
              onClick={() => setActiveSection('resumen')}
              className="inline-flex items-center gap-1 font-medium text-sky-700 hover:text-sky-900"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>Resumen Mensual e Impresión</span>
            </button>
          )}
          <span>Base de cálculo: 60 cuotas · Atención nacional</span>
        </div>
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AutofinWorkspace />
    </AuthProvider>
  );
}
