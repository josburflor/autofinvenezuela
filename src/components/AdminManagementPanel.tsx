import React, { useCallback, useEffect, useState } from 'react';
import {
  Check,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react';
import type { AdminRole, AdminUserDTO, AdvisorProfileDTO } from '../shared/types';
import { AdvisorProfileEditor } from './AdvisorProfileEditor';

interface AdminManagementPanelProps {
  currentUser: AdminUserDTO;
  advisorProfile: AdvisorProfileDTO;
  onSaveAdvisorProfile: (next: Partial<AdvisorProfileDTO>) => Promise<AdvisorProfileDTO>;
  authFetch: (input: string, init?: RequestInit) => Promise<Response>;
  onClosePanel: () => void;
  onSignOut: () => Promise<void>;
}

function generateSecurePassword(): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const digits = '23456789';
  const symbols = '*#@!';
  const pick = (chars: string) => chars[Math.floor(Math.random() * chars.length)];
  const randomPart = [
    pick(upper),
    pick(lower),
    pick(lower),
    pick(digits),
    pick(digits),
    pick(digits),
    pick(symbols),
    pick(upper),
  ].join('');
  return `Afv-${randomPart}`;
}

function formatRoleLabel(role: AdminRole): string {
  if (role === 'super_admin') return 'Administrador Principal';
  if (role === 'admin') return 'Administrador';
  return 'Asesor Comercial';
}

function formatDateShort(iso: string | null): string {
  if (!iso) return 'Sin ingresos previos';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Sin ingresos previos';
  return d.toLocaleString('es-VE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function AdminManagementPanel({
  currentUser,
  advisorProfile,
  onSaveAdvisorProfile,
  authFetch,
  onClosePanel,
  onSignOut,
}: AdminManagementPanelProps) {
  const [admins, setAdmins] = useState<AdminUserDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Estado formulario de creación de administrador y clave
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<AdminRole>('admin');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [creating, setCreating] = useState(false);

  // Credencial recién emitida para copiar y entregar
  const [issuedCredential, setIssuedCredential] = useState<{
    name: string;
    username: string;
    email: string;
    password: string;
    role: AdminRole;
  } | null>(null);
  const [copiedCreds, setCopiedCreds] = useState(false);

  // Estado cambio de clave en fila existente
  const [editingPasswordUid, setEditingPasswordUid] = useState<string | null>(null);
  const [newRowPassword, setNewRowPassword] = useState('');
  const [showRowPassword, setShowRowPassword] = useState(false);
  const [savingRowPassword, setSavingRowPassword] = useState(false);
  const [confirmDeleteUid, setConfirmDeleteUid] = useState<string | null>(null);

  const loadAdmins = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await authFetch('/api/crm/admins');
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'No se pudo cargar la lista de administradores.');
      }
      setAdmins(data as AdminUserDTO[]);
    } catch (err: unknown) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Error al consultar administradores en Cloud SQL.'
      );
    } finally {
      setLoading(false);
    }
  }, [authFetch]);

  useEffect(() => {
    loadAdmins();
  }, [loadAdmins]);

  const handleGenerateCreatePassword = () => {
    const generated = generateSecurePassword();
    setPassword(generated);
    setShowPassword(true);
  };

  const handleCreateAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);
    setCreating(true);

    try {
      const res = await authFetch('/api/crm/admins', {
        method: 'POST',
        body: JSON.stringify({
          displayName,
          username,
          email,
          role,
          password,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Error al crear el administrador.');
      }

      const created = data as AdminUserDTO;
      setIssuedCredential({
        name: created.displayName || displayName,
        username: created.username || username,
        email: created.email,
        password,
        role: created.role,
      });

      setDisplayName('');
      setUsername('');
      setEmail('');
      setPassword('');
      setRole('admin');
      setSuccessMsg(
        `Clave de acceso creada exitosamente para ${created.displayName || created.email}.`
      );
      await loadAdmins();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'No se pudo registrar el administrador.');
    } finally {
      setCreating(false);
    }
  };

  const handleCopyIssuedCredentials = async () => {
    if (!issuedCredential) return;
    const summary = [
      'Credenciales de Acceso — Autofin Venezuela CRM',
      `Nombre: ${issuedCredential.name}`,
      `Rol: ${formatRoleLabel(issuedCredential.role)}`,
      `Usuario: ${issuedCredential.username}`,
      `Correo: ${issuedCredential.email}`,
      `Clave: ${issuedCredential.password}`,
    ].join('\n');

    try {
      await navigator.clipboard.writeText(summary);
      setCopiedCreds(true);
      setTimeout(() => setCopiedCreds(false), 2500);
    } catch {
      setErrorMsg('No se pudo copiar automáticamente al portapapeles.');
    }
  };

  const handleUpdatePassword = async (targetUid: string, targetLabel: string) => {
    if (!newRowPassword || newRowPassword.length < 6) {
      setErrorMsg('La nueva clave debe tener al menos 6 caracteres.');
      return;
    }

    setSavingRowPassword(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await authFetch(`/api/crm/admins/${encodeURIComponent(targetUid)}/password`, {
        method: 'PATCH',
        body: JSON.stringify({ password: newRowPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'No se pudo actualizar la clave.');
      }

      const updated = data as AdminUserDTO;
      setIssuedCredential({
        name: updated.displayName || targetLabel,
        username: updated.username || updated.email,
        email: updated.email,
        password: newRowPassword,
        role: updated.role,
      });
      setEditingPasswordUid(null);
      setNewRowPassword('');
      setSuccessMsg(`Se actualizó la clave de acceso de ${targetLabel}.`);
      await loadAdmins();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Error al guardar la nueva clave.');
    } finally {
      setSavingRowPassword(false);
    }
  };

  const handleToggleActive = async (target: AdminUserDTO) => {
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await authFetch(`/api/crm/admins/${encodeURIComponent(target.uid)}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !target.isActive }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'No se pudo cambiar el estado de la cuenta.');
      }
      setSuccessMsg(
        `Cuenta de ${target.displayName || target.email} ${
          !target.isActive ? 'reactivada' : 'suspendida'
        } correctamente.`
      );
      await loadAdmins();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Error al actualizar estado.');
    }
  };

  const handleDeleteAdmin = async (target: AdminUserDTO) => {
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await authFetch(`/api/crm/admins/${encodeURIComponent(target.uid)}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'No se pudo eliminar la cuenta.');
      }
      setConfirmDeleteUid(null);
      setSuccessMsg(`Cuenta de ${target.displayName || target.email} retirada del sistema.`);
      await loadAdmins();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Error al eliminar administrador.');
    }
  };

  return (
    <div className="space-y-6">
      {/* Cabecera de Administración con botones explícitos Cerrar y Cerrar Sesión */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-sky-700 shrink-0">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">
              Administradores y Creación de Claves de Acceso
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Sesión activa: <strong className="text-slate-800">{currentUser.displayName || currentUser.email}</strong>{' '}
              · {formatRoleLabel(currentUser.role)} · Claves cifradas con scrypt en PostgreSQL
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={loadAdmins}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Actualizar</span>
          </button>

          <button
            type="button"
            onClick={onClosePanel}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-800 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors whitespace-nowrap shrink-0"
          >
            <X className="w-3.5 h-3.5" />
            <span>Cerrar</span>
          </button>

          <button
            type="button"
            onClick={onSignOut}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-red-700 rounded-lg hover:bg-red-800 transition-colors whitespace-nowrap shrink-0"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Cerrar Sesión</span>
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-xs font-medium text-red-800 flex items-center justify-between gap-4">
          <span>{errorMsg}</span>
          <button
            type="button"
            onClick={() => setErrorMsg(null)}
            className="text-red-700 hover:text-red-900 font-semibold"
          >
            Cerrar
          </button>
        </div>
      )}

      {successMsg && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-medium text-emerald-900 flex items-center justify-between gap-4">
          <span>{successMsg}</span>
          <button
            type="button"
            onClick={() => setSuccessMsg(null)}
            className="text-emerald-800 hover:text-emerald-950 font-semibold"
          >
            Cerrar
          </button>
        </div>
      )}

      {/* Tarjeta de Credencial Emitida Lista para Entregar */}
      {issuedCredential && (
        <div className="bg-white rounded-xl border border-sky-200 p-5 flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <p className="text-xs font-semibold text-sky-800">
              Credencial de Administrador Lista para Compartir
            </p>
            <p className="text-sm text-slate-800">
              <strong>{issuedCredential.name}</strong> · Usuario:{' '}
              <code className="font-mono bg-slate-100 px-1.5 py-0.5 rounded">
                {issuedCredential.username}
              </code>{' '}
              · Correo:{' '}
              <code className="font-mono bg-slate-100 px-1.5 py-0.5 rounded">
                {issuedCredential.email}
              </code>{' '}
              · Clave asignada:{' '}
              <code className="font-mono font-semibold text-slate-900 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded">
                {issuedCredential.password}
              </code>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopyIssuedCredentials}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-sky-700 rounded-lg hover:bg-sky-800 transition-colors whitespace-nowrap shrink-0"
            >
              {copiedCreds ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedCreds ? 'Credenciales Copiadas' : 'Copiar Credenciales'}</span>
            </button>
            <button
              type="button"
              onClick={() => setIssuedCredential(null)}
              className="px-3 py-2 text-xs font-medium text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
            >
              Cerrar
            </button>
          </div>
        </div>
      )}

      {/* Editor de Foto (<= 200 KB) y Perfil Público del Asesor Jesús Artahona */}
      <AdvisorProfileEditor
        profile={advisorProfile}
        onSaveProfile={onSaveAdvisorProfile}
      />

      {/* Grid Principal: Crear Clave de Administrador (Izquierda) + Directorio Activo (Derecha) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Formulario: Crear Nuevo Administrador y Clave */}
        <form
          onSubmit={handleCreateAdmin}
          className="lg:col-span-4 bg-white rounded-xl border border-slate-200 p-6 space-y-4"
        >
          <div className="flex items-center gap-2 pb-3 border-b border-slate-200">
            <UserPlus className="w-4 h-4 text-sky-700 shrink-0" />
            <h2 className="text-base font-bold text-slate-900">
              Crear Clave de Administrador
            </h2>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Nombre y Apellido *
            </label>
            <input
              type="text"
              required
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Ej. María Fernanda Gómez"
              className="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-600"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Usuario de Acceso *
            </label>
            <input
              type="text"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value.replace(/\s+/g, '').toLowerCase())}
              placeholder="Ej. mfgomez"
              className="w-full px-3.5 py-2 text-sm font-mono rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-600"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Correo Electrónico *
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="mgomez@autofinvenezuela.com"
              className="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-600"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Nivel de Permiso *
            </label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as AdminRole)}
              className="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-sky-600"
            >
              <option value="admin">Administrador (Gestión CRM + Claves)</option>
              <option value="super_admin">Administrador Principal</option>
              <option value="asesor">Asesor Comercial (Solo Cartera y Citas)</option>
            </select>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-medium text-slate-700">
                Clave de Acceso (mín. 6 caracteres) *
              </label>
              <button
                type="button"
                onClick={handleGenerateCreatePassword}
                className="text-xs font-semibold text-sky-700 hover:text-sky-900"
              >
                Generar clave segura
              </button>
            </div>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Ingrese o genere una clave"
                className="w-full pl-3.5 pr-10 py-2 text-sm font-mono rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-600"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label="Mostrar u ocultar clave"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 p-1"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={creating}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-sky-700 rounded-lg hover:bg-sky-800 disabled:opacity-60 transition-colors"
          >
            <KeyRound className="w-4 h-4" />
            <span>{creating ? 'Creando clave...' : 'Crear Administrador y Guardar Clave'}</span>
          </button>
        </form>

        {/* Tabla: Administradores Registrados y Gestión de Claves */}
        <div className="lg:col-span-8 bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Cuentas de Administradores y Asesores ({admins.length})
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Puede asignar o renovar la clave de cualquier cuenta en cualquier momento
              </p>
            </div>
          </div>

          {loading ? (
            <div className="p-8 text-center text-sm text-slate-500">
              Cargando cuentas de administradores...
            </div>
          ) : (
            <div className="divide-y divide-slate-200">
              {admins.map((adm) => {
                const isSelf = adm.uid === currentUser.uid;
                const isMasterSeed = adm.uid === 'admin-master-autofin';
                const isEditingPass = editingPasswordUid === adm.uid;

                return (
                  <div key={adm.uid} className="p-5 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-4">
                      <div className="space-y-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-bold text-slate-900">
                            {adm.displayName || adm.email}
                          </span>
                          <span className="text-xs text-slate-400" aria-hidden="true">
                            ·
                          </span>
                          <span className="text-xs font-medium text-sky-800">
                            {formatRoleLabel(adm.role)}
                          </span>
                          {isSelf && (
                            <>
                              <span className="text-xs text-slate-400" aria-hidden="true">
                                ·
                              </span>
                              <span className="text-xs font-semibold text-emerald-700">
                                Tu sesión actual
                              </span>
                            </>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 font-mono tabular-nums">
                          <span>Usuario: {adm.username || adm.email.split('@')[0]}</span>
                          <span aria-hidden="true">·</span>
                          <span>{adm.email}</span>
                          <span aria-hidden="true">·</span>
                          <span>
                            {adm.hasPassword ? 'Clave configurada' : 'Sin clave local (Google)'}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className={adm.isActive ? 'text-emerald-700' : 'text-red-700'}>
                            {adm.isActive ? 'Activo' : 'Suspendido'}
                          </span>
                        </div>

                        <p className="text-xs text-slate-400 font-mono tabular-nums">
                          Último ingreso: {formatDateShort(adm.lastLoginAt)}
                          {adm.createdBy ? ` · Creado por: ${adm.createdBy}` : ''}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            if (isEditingPass) {
                              setEditingPasswordUid(null);
                              setNewRowPassword('');
                            } else {
                              setEditingPasswordUid(adm.uid);
                              setNewRowPassword('');
                              setShowRowPassword(true);
                            }
                          }}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-800 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors whitespace-nowrap shrink-0"
                        >
                          <KeyRound className="w-3.5 h-3.5 text-sky-700" />
                          <span>
                            {isEditingPass
                              ? 'Cerrar'
                              : adm.hasPassword
                                ? 'Cambiar Clave'
                                : 'Asignar Clave'}
                          </span>
                        </button>

                        {!isSelf && !isMasterSeed && (
                          <>
                            <button
                              type="button"
                              onClick={() => handleToggleActive(adm)}
                              className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
                            >
                              {adm.isActive ? 'Suspender' : 'Activar'}
                            </button>

                            {confirmDeleteUid === adm.uid ? (
                              <div className="inline-flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => handleDeleteAdmin(adm)}
                                  className="px-2.5 py-1.5 text-xs font-semibold text-white bg-red-700 rounded-lg hover:bg-red-800 whitespace-nowrap"
                                >
                                  Confirmar
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteUid(null)}
                                  className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 whitespace-nowrap"
                                >
                                  Cancelar
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteUid(adm.uid)}
                                title="Eliminar cuenta"
                                className="p-1.5 text-slate-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </div>

                    {/* Panel en línea para renovar o asignar clave */}
                    {isEditingPass && (
                      <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center gap-2">
                        <div className="relative flex-1 min-w-[220px]">
                          <input
                            type={showRowPassword ? 'text' : 'password'}
                            value={newRowPassword}
                            onChange={(e) => setNewRowPassword(e.target.value)}
                            placeholder="Nueva clave para este administrador (mín. 6 caracteres)"
                            className="w-full pl-3 pr-9 py-2 text-xs font-mono rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-600"
                          />
                          <button
                            type="button"
                            onClick={() => setShowRowPassword((v) => !v)}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                          >
                            {showRowPassword ? (
                              <EyeOff className="w-3.5 h-3.5" />
                            ) : (
                              <Eye className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            setNewRowPassword(generateSecurePassword());
                            setShowRowPassword(true);
                          }}
                          className="px-3 py-2 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors whitespace-nowrap shrink-0"
                        >
                          Generar Clave
                        </button>

                        <button
                          type="button"
                          disabled={savingRowPassword}
                          onClick={() =>
                            handleUpdatePassword(adm.uid, adm.displayName || adm.email)
                          }
                          className="px-3.5 py-2 text-xs font-semibold text-white bg-sky-700 rounded-lg hover:bg-sky-800 disabled:opacity-60 transition-colors whitespace-nowrap shrink-0"
                        >
                          {savingRowPassword ? 'Guardando...' : 'Guardar Nueva Clave'}
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setEditingPasswordUid(null);
                            setNewRowPassword('');
                          }}
                          className="px-3 py-2 text-xs font-medium text-slate-600 hover:text-slate-900"
                        >
                          Cerrar
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
