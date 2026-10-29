import React, { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  Eye,
  EyeOff,
  Mail,
  Send,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import {
  OFFICIAL_OFFICE_ADDRESS,
  type AdvisorProfileDTO,
  type CalculatorSettingsDTO,
  type EmailSettingsDTO,
} from '../shared/types';
import { tryBackendJson } from '../lib/api-url';
import { AdvisorProfileEditor } from './AdvisorProfileEditor';
import { FinancingCalculator } from './FinancingCalculator';

interface PortalSettingsPanelProps {
  isAdmin: boolean;
  advisorProfile: AdvisorProfileDTO;
  calculatorSettings: CalculatorSettingsDTO;
  authFetch: (input: string, init?: RequestInit) => Promise<Response>;
  onSaveAdvisorProfile: (next: Partial<AdvisorProfileDTO>) => Promise<AdvisorProfileDTO>;
  onSaveCalculatorSettings: (next: CalculatorSettingsDTO) => Promise<void>;
  onClose: () => void;
}

export function PortalSettingsPanel({
  isAdmin,
  advisorProfile,
  calculatorSettings,
  authFetch,
  onSaveAdvisorProfile,
  onSaveCalculatorSettings,
  onClose,
}: PortalSettingsPanelProps) {
  const [emailCfg, setEmailCfg] = useState<EmailSettingsDTO | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [smtpHost, setSmtpHost] = useState('smtp.gmail.com');
  const [smtpPort, setSmtpPort] = useState('465');
  const [smtpSecure, setSmtpSecure] = useState(true);
  const [smtpUser, setSmtpUser] = useState('');
  const [smtpPass, setSmtpPass] = useState('');
  const [showSmtpPass, setShowSmtpPass] = useState(false);
  const [senderName, setSenderName] = useState('Autofin Venezuela · Jesús Artahona');
  const [replyToEmail, setReplyToEmail] = useState('');
  const [advisorNotifyEmail, setAdvisorNotifyEmail] = useState('');
  const [sendCopyToAdvisor, setSendCopyToAdvisor] = useState(true);

  const [testRecipient, setTestRecipient] = useState('');
  const [savingEmail, setSavingEmail] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailSuccess, setEmailSuccess] = useState<string | null>(null);

  const loadEmailConfig = useCallback(async () => {
    const res = await tryBackendJson<EmailSettingsDTO>(
      '/api/crm/email-settings',
      undefined,
      authFetch
    );
    if (!res.ok || !res.data) return;
    const data = res.data;
    setEmailCfg(data);
    setEnabled(data.enabled);
    setSmtpHost(data.smtpHost || 'smtp.gmail.com');
    setSmtpPort(String(data.smtpPort || 465));
    setSmtpSecure(data.smtpSecure);
    setSmtpUser(data.smtpUser || '');
    setSenderName(data.senderName || `Autofin Venezuela · ${advisorProfile.advisorName}`);
    setReplyToEmail(data.replyToEmail || '');
    setAdvisorNotifyEmail(data.advisorNotifyEmail || '');
    setSendCopyToAdvisor(data.sendCopyToAdvisor);
  }, [authFetch, advisorProfile.advisorName]);

  useEffect(() => {
    loadEmailConfig();
  }, [loadEmailConfig]);

  const handleSaveEmailSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingEmail(true);
    setEmailError(null);
    setEmailSuccess(null);
    try {
      const res = await tryBackendJson<EmailSettingsDTO>(
        '/api/crm/email-settings',
        {
          method: 'PUT',
          body: JSON.stringify({
            enabled,
            smtpHost,
            smtpPort: Number(smtpPort) || 465,
            smtpSecure,
            smtpUser,
            ...(smtpPass.trim() ? { smtpPass: smtpPass.trim() } : {}),
            senderName,
            replyToEmail,
            advisorNotifyEmail,
            sendCopyToAdvisor,
          }),
        },
        authFetch
      );
      if (!res.backendAvailable) {
        throw new Error(
          'El despacho SMTP requiere servidor Express conectado (VITE_API_ORIGIN). Su portal e imágenes Hero y calculadora sí están activos en Firebase Cloud Firestore.'
        );
      }
      if (!res.ok || !res.data) {
        throw new Error(res.error || 'No se pudo guardar la configuración de correo.');
      }
      setEmailCfg(res.data);
      setSmtpPass('');
      setEmailSuccess('Configuración de correo automático guardada correctamente.');
      setTimeout(() => setEmailSuccess(null), 4500);
    } catch (err: unknown) {
      setEmailError(
        err instanceof Error ? err.message : 'Error al guardar configuración SMTP.'
      );
    } finally {
      setSavingEmail(false);
    }
  };

  const handleSendTest = async () => {
    if (!testRecipient.trim()) {
      setEmailError('Escriba una dirección de correo destino para enviar la prueba.');
      return;
    }
    setSendingTest(true);
    setEmailError(null);
    setEmailSuccess(null);
    try {
      const res = await tryBackendJson<{ message?: string }>(
        '/api/crm/email-settings/test',
        {
          method: 'POST',
          body: JSON.stringify({ recipientEmail: testRecipient.trim() }),
        },
        authFetch
      );
      if (!res.backendAvailable) {
        throw new Error(
          'El envío de correo SMTP requiere servidor Express conectado (VITE_API_ORIGIN).'
        );
      }
      if (!res.ok) {
        throw new Error(res.error || 'Falló el envío del correo de prueba.');
      }
      setEmailSuccess(res.data?.message || 'Correo de prueba enviado correctamente.');
    } catch (err: unknown) {
      setEmailError(
        err instanceof Error ? err.message : 'No se pudo despachar el correo de prueba.'
      );
    } finally {
      setSendingTest(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Encabezado de Sección */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <div className="w-10 h-10 rounded-lg bg-sky-50 border border-sky-200 flex items-center justify-center text-sky-700 shrink-0">
            <SlidersHorizontal className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">
              Personalización de Captación Web, Calculadora y Correo al Cliente
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Modifica las imágenes Hero del portal, sede oficial en Valencia, tasas/cuotas de la
              calculadora y el correo automático que recibe cada cliente nombrando a{' '}
              <strong className="text-slate-800">{advisorProfile.advisorName}</strong>.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-800 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors whitespace-nowrap shrink-0"
        >
          <X className="w-3.5 h-3.5" />
          <span>Cerrar</span>
        </button>
      </div>

      {/* 1. Editor de Imagen Hero, Sede Oficial (CC Salvamall, Valencia) y Foto del Asesor */}
      <AdvisorProfileEditor
        profile={advisorProfile}
        onSaveProfile={onSaveAdvisorProfile}
      />

      {/* 2. Configuración Completa de la Calculadora de Financiamiento */}
      <div className="space-y-3">
        <div>
          <h2 className="text-base font-bold text-slate-900">
            Modificar Parámetros y Planes de la Calculadora de Financiamiento
          </h2>
          <p className="text-xs text-slate-500">
            Cualquier ajuste que guardes aquí actualiza de inmediato la Calculadora de Captación Web
            y la Calculadora interna de las fichas de clientes.
          </p>
        </div>

        <FinancingCalculator
          settings={calculatorSettings}
          canConfigure={true}
          defaultOpenConfig={true}
          onSaveSettings={onSaveCalculatorSettings}
        />
      </div>

      {/* 3. Correo Automático al Cliente cuando ingresa sus datos */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
          <div className="flex items-start gap-3">
            <Mail className="w-5 h-5 text-sky-700 mt-0.5 shrink-0" />
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Correo Automático de Confirmación al Cliente (SMTP)
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Cuando un cliente registra sus datos en Captación Web, el sistema le envía un correo
                con todo lo que escribió, lo que desea financiar, la sede oficial y el nombre de su
                asesor asignado ({advisorProfile.advisorName}).
              </p>
            </div>
          </div>

          <div className="text-xs font-medium">
            {emailCfg?.configuredReady ? (
              <span className="inline-flex items-center gap-1.5 text-emerald-700">
                <CheckCircle2 className="w-4 h-4" />
                Envío automático SMTP activo ({emailCfg.smtpUser})
              </span>
            ) : (
              <span className="text-amber-700">
                Pendiente de ingresar correo y clave de aplicación SMTP
              </span>
            )}
          </div>
        </div>

        {emailError && (
          <div className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-xs font-medium text-red-800">
            {emailError}
          </div>
        )}

        {emailSuccess && (
          <div className="p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs font-medium text-emerald-900">
            {emailSuccess}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {isAdmin ? (
            <form onSubmit={handleSaveEmailSettings} className="lg:col-span-7 space-y-4">
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-sky-700 focus:ring-sky-600"
                />
                <span className="text-xs font-semibold text-slate-800">
                  Enviar automáticamente correo de confirmación al cliente al enviar el formulario web
                </span>
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Servidor SMTP *
                  </label>
                  <input
                    type="text"
                    required
                    value={smtpHost}
                    onChange={(e) => setSmtpHost(e.target.value)}
                    placeholder="smtp.gmail.com"
                    className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Puerto SMTP *
                  </label>
                  <input
                    type="number"
                    required
                    value={smtpPort}
                    onChange={(e) => {
                      const val = e.target.value;
                      setSmtpPort(val);
                      setSmtpSecure(Number(val) === 465);
                    }}
                    placeholder="465"
                    className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Correo Remitente (Usuario SMTP) *
                  </label>
                  <input
                    type="email"
                    value={smtpUser}
                    onChange={(e) => setSmtpUser(e.target.value)}
                    placeholder="autofinvenezuela@gmail.com"
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Clave de Aplicación SMTP {emailCfg?.hasSmtpPass ? '(Ya guardada)' : '*'}
                  </label>
                  <div className="relative">
                    <input
                      type={showSmtpPass ? 'text' : 'password'}
                      value={smtpPass}
                      onChange={(e) => setSmtpPass(e.target.value)}
                      placeholder={
                        emailCfg?.hasSmtpPass
                          ? 'Dejar en blanco para conservar actual'
                          : 'Ej. Clave de aplicación de 16 letras'
                      }
                      className="w-full pl-3 pr-9 py-2 text-xs font-mono rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-600"
                    />
                    <button
                      type="button"
                      onClick={() => setShowSmtpPass((v) => !v)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                    >
                      {showSmtpPass ? (
                        <EyeOff className="w-3.5 h-3.5" />
                      ) : (
                        <Eye className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Nombre Visible del Remitente
                  </label>
                  <input
                    type="text"
                    value={senderName}
                    onChange={(e) => setSenderName(e.target.value)}
                    placeholder={`Autofin Venezuela · ${advisorProfile.advisorName}`}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Correo para Copia al Asesor (Opcional)
                  </label>
                  <input
                    type="email"
                    value={advisorNotifyEmail}
                    onChange={(e) => setAdvisorNotifyEmail(e.target.value)}
                    placeholder="asesor@autofinvenezuela.com"
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-600"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={sendCopyToAdvisor}
                    onChange={(e) => setSendCopyToAdvisor(e.target.checked)}
                    className="w-3.5 h-3.5 rounded border-slate-300 text-sky-700"
                  />
                  <span>Enviar copia oculta (BCC) al correo del asesor en cada registro</span>
                </label>

                <button
                  type="submit"
                  disabled={savingEmail}
                  className="px-4 py-2 text-xs font-semibold text-white bg-sky-700 rounded-lg hover:bg-sky-800 disabled:opacity-60 transition-colors"
                >
                  {savingEmail ? 'Guardando SMTP...' : 'Guardar Configuración de Correo'}
                </button>
              </div>

              {/* Prueba de envío inmediata */}
              <div className="pt-4 border-t border-slate-200 flex flex-wrap items-end gap-2">
                <div className="flex-1 min-w-[220px]">
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Probar envío real de correo ahora
                  </label>
                  <input
                    type="email"
                    value={testRecipient}
                    onChange={(e) => setTestRecipient(e.target.value)}
                    placeholder="correo-destino@ejemplo.com"
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-600"
                  />
                </div>
                <button
                  type="button"
                  disabled={sendingTest}
                  onClick={handleSendTest}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-800 bg-slate-100 rounded-lg hover:bg-slate-200 disabled:opacity-60 transition-colors whitespace-nowrap"
                >
                  <Send className="w-3.5 h-3.5 text-sky-700" />
                  <span>{sendingTest ? 'Enviando...' : 'Enviar Correo de Prueba'}</span>
                </button>
              </div>
            </form>
          ) : (
            <div className="lg:col-span-7 p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600">
              Solo una cuenta con rol de Administrador puede editar las credenciales del servidor
              SMTP. Puede enviar resúmenes de correo individuales desde cada ficha de cliente.
            </div>
          )}

          {/* Vista Previa del Correo que Recibe el Cliente */}
          <div className="lg:col-span-5 rounded-xl border border-slate-200 bg-slate-50 overflow-hidden">
            <div className="bg-slate-900 text-white px-4 py-3">
              <div className="text-[10px] font-semibold text-sky-300 tracking-wide">
                VISTA PREVIA DEL CORREO QUE RECIBE EL CLIENTE
              </div>
              <div className="text-xs font-bold mt-0.5">
                Confirmación de Solicitud — Autofin Venezuela (Asesor: {advisorProfile.advisorName})
              </div>
            </div>
            <div className="p-4 space-y-3 text-xs text-slate-700">
              <p>
                Hola <strong>[Nombre del Cliente]</strong>, recibimos tu solicitud en{' '}
                <strong>Autofin Venezuela</strong>.
              </p>
              <div className="p-3 rounded-lg bg-white border border-sky-200 space-y-0.5">
                <div className="text-[10px] font-bold text-sky-700 uppercase">
                  Tu Asesor Asignado
                </div>
                <div className="font-bold text-slate-900">{advisorProfile.advisorName}</div>
                <div className="text-[11px] text-slate-500">{advisorProfile.advisorTitle}</div>
              </div>
              <div className="p-3 rounded-lg bg-white border border-slate-200 space-y-1 text-[11px]">
                <div>
                  <strong>Datos registrados:</strong> Cédula, Teléfono, Correo y Ciudad
                </div>
                <div>
                  <strong>Monto disponible:</strong> $[Presupuesto Inicial] USD
                </div>
                <div>
                  <strong>Lo que desea adquirir:</strong> Vehículo / Moto (Marca, Modelo, Año,
                  Condición) o Inmueble confirmado
                </div>
              </div>
              <div className="text-[11px] text-slate-500 pt-1 border-t border-slate-200">
                <strong className="text-slate-800">Sede Oficial:</strong>{' '}
                {advisorProfile.officeAddress || OFFICIAL_OFFICE_ADDRESS}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
