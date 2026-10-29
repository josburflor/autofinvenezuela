import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  Bike,
  Building2,
  Calculator,
  Car,
  CheckCircle2,
  MailCheck,
  MapPin,
  ShieldCheck,
  UserCheck,
} from 'lucide-react';
import heroVehiculoImg from '../assets/images/autofin_hero_vehiculo_1793257817332.jpg';
import heroMotoImg from '../assets/images/autofin_hero_moto_1793262763387.jpg';
import heroInmuebleImg from '../assets/images/autofin_inmueble_comercial_1793257817601.jpg';
import { apiFetch } from '../lib/api-url';
import {
  DEFAULT_ADVISOR_PHOTO_URL,
  OFFICIAL_OFFICE_ADDRESS,
  type AdvisorProfileDTO,
  type CreatePublicLeadPayload,
  type InterestType,
  type LeadRecordDTO,
} from '../shared/types';

interface PublicLeadFormProps {
  mode?: 'public' | 'crm';
  authFetch?: (input: string, init?: RequestInit) => Promise<Response>;
  prefillAmount?: number | null;
  advisorProfile?: AdvisorProfileDTO;
  onLeadSubmitted?: (lead: LeadRecordDTO) => void;
  onScrollToCalculator?: () => void;
}

const VENEZUELAN_CITIES = [
  'Valencia',
  'Naguanagua',
  'San Diego',
  'Guacara',
  'Puerto Cabello',
  'Maracay',
  'Barquisimeto',
  'Caracas',
  'Maracaibo',
  'Lechería',
  'Puerto Ordaz',
  'San Cristóbal',
  'Maturín',
  'Mérida',
  'Porlamar',
];

const HERO_VEHICULO_SRC = heroVehiculoImg;
const HERO_MOTO_SRC = heroMotoImg;
const HERO_INMUEBLE_SRC = heroInmuebleImg;

export function PublicLeadForm({
  mode = 'public',
  authFetch,
  prefillAmount = null,
  advisorProfile,
  onLeadSubmitted,
  onScrollToCalculator,
}: PublicLeadFormProps) {
  const displayAdvisorName = advisorProfile?.advisorName || 'Jesús Artahona';
  const displayAdvisorTitle =
    advisorProfile?.advisorTitle || 'Asesor Comercial Oficial · Autofin Venezuela';
  const displayAdvisorPhoto = advisorProfile?.photoUrl || DEFAULT_ADVISOR_PHOTO_URL;
  const displayAdvisorBio =
    advisorProfile?.welcomeBio ||
    'Atención personalizada desde nuestra sede en CC Salvamall, Valencia, Carabobo, en planes de compra programada y entrega garantizada para vehículos, motos e inmuebles.';
  const displayOfficeAddress = advisorProfile?.officeAddress || OFFICIAL_OFFICE_ADDRESS;
  const displayHeroTitle =
    advisorProfile?.heroTitle || 'Planifica tu vehículo, moto o inmueble con cuotas fijas';
  const displayHeroSubtitle =
    advisorProfile?.heroSubtitle || 'Sede Oficial · CC Salvamall, Valencia, Carabobo';

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [cedula, setCedula] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [city, setCity] = useState('Valencia');
  const [availableAmount, setAvailableAmount] = useState('');
  const [interestType, setInterestType] = useState<InterestType>('vehiculo');

  // Campos condicionales para Vehículo / Moto
  const [condition, setCondition] = useState<'Nuevo' | 'Usado'>('Nuevo');
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');

  // Confirmación condicional obligatoria para Inmueble
  const [propertySeenConfirmed, setPropertySeenConfirmed] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [submittedLead, setSubmittedLead] = useState<LeadRecordDTO | null>(null);
  const [imgFailed, setImgFailed] = useState(false);
  const [advisorImgFailed, setAdvisorImgFailed] = useState(false);

  useEffect(() => {
    if (prefillAmount !== null && prefillAmount > 0) {
      setAvailableAmount(String(prefillAmount));
    }
  }, [prefillAmount]);

  const handleInterestChange = (nextType: InterestType) => {
    setInterestType(nextType);
    setErrorMsg(null);
    setImgFailed(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const parsedAmount = Number(availableAmount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setErrorMsg('Por favor ingrese un monto disponible válido mayor a $0.');
      return;
    }

    const isMotorized = interestType === 'vehiculo' || interestType === 'moto';

    if (isMotorized) {
      const parsedYear = Number(year);
      if (!brand.trim() || !model.trim() || !parsedYear || parsedYear < 1990 || parsedYear > 2028) {
        setErrorMsg(
          interestType === 'moto'
            ? 'Complete la condición, año válido, marca y modelo de la moto.'
            : 'Complete la condición, año válido, marca y modelo del vehículo.'
        );
        return;
      }
    } else {
      if (!propertySeenConfirmed) {
        setErrorMsg(
          'Debe confirmar que ya tiene la propiedad vista y conoce su monto antes de enviar.'
        );
        return;
      }
    }

    const payload: CreatePublicLeadPayload = {
      firstName,
      lastName,
      cedula,
      phone,
      email,
      city,
      availableAmount: parsedAmount,
      interestType,
      ...(isMotorized
        ? {
            vehicle: {
              condition,
              year: Number(year),
              brand,
              model,
            },
          }
        : {
            property: {
              propertySeenConfirmed,
            },
          }),
    };

    setSubmitting(true);
    try {
      const res =
        mode === 'crm' && authFetch
          ? await authFetch('/api/crm/leads', {
              method: 'POST',
              body: JSON.stringify({
                ...payload,
                source: 'Asesor CRM',
              }),
            })
          : await apiFetch('/api/public/leads', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'No se pudo procesar su solicitud.');
      }

      const createdLead = data as LeadRecordDTO;
      if (mode === 'crm') {
        if (onLeadSubmitted) {
          onLeadSubmitted(createdLead);
        }
        return;
      }

      setSubmittedLead(createdLead);
      if (onLeadSubmitted) {
        onLeadSubmitted(createdLead);
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Error de conexión al enviar formulario.');
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setSubmittedLead(null);
    setFirstName('');
    setLastName('');
    setCedula('');
    setPhone('');
    setEmail('');
    setAvailableAmount('');
    setBrand('');
    setModel('');
    setPropertySeenConfirmed(false);
    setErrorMsg(null);
  };

  const activeHeroImage =
    interestType === 'vehiculo'
      ? advisorProfile?.heroVehiculoUrl || HERO_VEHICULO_SRC
      : interestType === 'moto'
        ? advisorProfile?.heroMotoUrl || HERO_MOTO_SRC
        : advisorProfile?.heroInmuebleUrl || HERO_INMUEBLE_SRC;

  useEffect(() => {
    setImgFailed(false);
  }, [activeHeroImage]);

  useEffect(() => {
    setAdvisorImgFailed(false);
  }, [displayAdvisorPhoto]);

  return (
    <div
      id={mode === 'public' ? 'formulario-captacion-web' : undefined}
      className={mode === 'crm' ? 'p-6 bg-white' : 'max-w-7xl mx-auto px-6 py-10 scroll-mt-24'}
    >
      <div
        className={
          mode === 'crm'
            ? 'max-w-3xl mx-auto'
            : 'grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch'
        }
      >
        {/* Columna Informativa & Visual Autofin Venezuela (Solo en modo público) */}
        {mode === 'public' && (
          <div className="lg:col-span-5 flex flex-col justify-between bg-slate-900 text-white rounded-xl overflow-hidden border border-slate-800">
          <div className="relative h-64 sm:h-72 w-full bg-slate-800 overflow-hidden">
            {!imgFailed ? (
              <img
                src={activeHeroImage}
                alt={
                  interestType === 'vehiculo'
                    ? 'Financiamiento programado de vehículos Autofin Venezuela'
                    : interestType === 'moto'
                      ? 'Financiamiento programado de motos nuevas y usadas Autofin Venezuela'
                      : 'Financiamiento de viviendas y galpones comerciales Autofin Venezuela'
                }
                referrerPolicy="no-referrer"
                onError={() => setImgFailed(true)}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center bg-slate-800 text-slate-300 p-6 text-center">
                {interestType === 'vehiculo' ? (
                  <Car className="w-10 h-10 mb-2 text-sky-400" />
                ) : interestType === 'moto' ? (
                  <Bike className="w-10 h-10 mb-2 text-sky-400" />
                ) : (
                  <Building2 className="w-10 h-10 mb-2 text-sky-400" />
                )}
                <span className="text-sm font-medium">Autofin Venezuela — Compra Programada</span>
              </div>
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-slate-900/45 to-transparent" />
            <div className="absolute bottom-5 left-6 right-6">
              <p className="text-xs text-sky-300 font-medium tracking-wide">
                {displayHeroSubtitle}
              </p>
              <h1 className="text-2xl sm:text-3xl font-bold text-white mt-1 [text-wrap:balance]">
                {displayHeroTitle}
              </h1>
            </div>
          </div>

          <div className="p-6 sm:p-8 flex-1 flex flex-col justify-between gap-6">
            <div className="space-y-5">
              {/* Tarjeta Oficial del Asesor Jesús Artahona */}
              <div className="flex items-center gap-4 p-4 rounded-xl bg-slate-800/85 border border-slate-700/80">
                <div className="w-20 h-20 rounded-full overflow-hidden bg-white p-0.5 shrink-0 flex items-center justify-center shadow-sm">
                  {!advisorImgFailed ? (
                    <img
                      src={displayAdvisorPhoto}
                      alt={displayAdvisorName}
                      onError={() => setAdvisorImgFailed(true)}
                      className="w-full h-full rounded-full object-cover"
                    />
                  ) : (
                    <UserCheck className="w-8 h-8 text-sky-700" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-sky-300 font-medium">Tu Asesor Asignado</p>
                  <h2 className="text-lg font-bold text-white truncate">{displayAdvisorName}</h2>
                  <p className="text-xs text-slate-300 truncate">{displayAdvisorTitle}</p>
                </div>
              </div>

              <p className="text-sm text-slate-300 leading-relaxed">{displayAdvisorBio}</p>

              <div className="pt-4 border-t border-slate-800 space-y-3 text-sm">
                <div className="flex items-start justify-between gap-4">
                  <span className="text-slate-400 inline-flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                    Sede Principal
                  </span>
                  <span className="text-white font-medium text-right">
                    {displayOfficeAddress}
                  </span>
                </div>
                <div className="flex items-start justify-between gap-4">
                  <span className="text-slate-400">Plazo Base de Financiamiento</span>
                  <span className="font-mono tabular-nums text-white font-medium">60 cuotas</span>
                </div>
                <div className="flex items-start justify-between gap-4">
                  <span className="text-slate-400">Modalidades de Adjudicación</span>
                  <span className="font-mono tabular-nums text-white font-medium">
                    25–75 días hábiles
                  </span>
                </div>
                <div className="flex items-start justify-between gap-4">
                  <span className="text-slate-400">Verticales Atendidas</span>
                  <span className="text-white font-medium text-right">
                    Vehículos · Motos · Inmuebles
                  </span>
                </div>
              </div>

              {onScrollToCalculator && (
                <div className="flex flex-wrap items-center gap-2.5 pt-2">
                  <button
                    type="button"
                    onClick={onScrollToCalculator}
                    className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-slate-900 bg-white rounded-lg hover:bg-slate-100 transition-colors whitespace-nowrap shrink-0"
                  >
                    <Calculator className="w-3.5 h-3.5 text-sky-700" />
                    <span>Ver Calculadora Abajo</span>
                  </button>
                </div>
              )}
            </div>

            <div className="pt-4 border-t border-slate-800 flex items-center gap-3 text-xs text-slate-400">
              <ShieldCheck className="w-4 h-4 text-sky-400 shrink-0" />
              <span>
                Tus datos llegan directamente a la bandeja de atención de {displayAdvisorName} en{' '}
                {displayOfficeAddress}.
              </span>
            </div>
          </div>
        </div>
        )}

        {/* Columna Formulario Condicional */}
        <div
          className={
            mode === 'crm'
              ? 'flex flex-col justify-center'
              : 'lg:col-span-7 bg-white rounded-xl border border-slate-200 p-6 sm:p-8 flex flex-col justify-center'
          }
        >
          {submittedLead ? (
            <div className="py-6 space-y-5">
              <div className="w-12 h-12 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-700">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <div className="space-y-2">
                <p className="text-xs text-slate-500 font-mono tabular-nums">
                  Solicitud #{submittedLead.id} · Registrada correctamente
                </p>
                <h2 className="text-2xl font-bold text-slate-900">
                  Recibimos tu solicitud, {submittedLead.firstName}
                </h2>
                <p className="text-sm text-slate-600 leading-relaxed max-w-xl">
                  Tu asesor asignado <strong>{displayAdvisorName}</strong> ({displayAdvisorTitle})
                  revisará tu requerimiento desde nuestra sede en{' '}
                  <strong>{displayOfficeAddress}</strong> y se comunicará contigo al{' '}
                  <span className="font-mono tabular-nums text-slate-900">
                    {submittedLead.phone}
                  </span>
                  .
                </p>
              </div>

              {submittedLead.emailDelivery?.sent && (
                <div className="p-3.5 rounded-xl bg-sky-50 border border-sky-200 flex items-start gap-3 text-xs text-sky-950">
                  <MailCheck className="w-4 h-4 text-sky-700 mt-0.5 shrink-0" />
                  <div>
                    <strong>Comprobante enviado a tu correo ({submittedLead.email}):</strong> Te
                    enviamos un resumen con los datos que registraste, el bien que deseas adquirir y
                    el nombre de tu asesor asignado ({displayAdvisorName}).
                  </div>
                </div>
              )}

              {/* Resumen explícito de lo que el cliente escribió y desea */}
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2.5 text-xs">
                <div className="font-bold text-slate-900">
                  Resumen de tus datos registrados (Asesor: {displayAdvisorName})
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-slate-700">
                  <div>
                    <span className="text-slate-500">Solicitante:</span>{' '}
                    <strong>
                      {submittedLead.firstName} {submittedLead.lastName}
                    </strong>{' '}
                    ({submittedLead.cedula})
                  </div>
                  <div>
                    <span className="text-slate-500">Correo y Ciudad:</span>{' '}
                    {submittedLead.email} · {submittedLead.city}
                  </div>
                  <div>
                    <span className="text-slate-500">Monto inicial disponible:</span>{' '}
                    <strong className="font-mono tabular-nums text-slate-900">
                      ${Number(submittedLead.availableAmount).toLocaleString('en-US', {
                        minimumFractionDigits: 2,
                      })}{' '}
                      USD
                    </strong>
                  </div>
                  <div>
                    <span className="text-slate-500">Lo que deseas financiar:</span>{' '}
                    <strong>
                      {(submittedLead.interestType === 'vehiculo' ||
                        submittedLead.interestType === 'moto') &&
                      submittedLead.vehicleRequest
                        ? `${submittedLead.interestType === 'moto' ? 'Moto' : 'Vehículo'} ${submittedLead.vehicleRequest.condition}: ${submittedLead.vehicleRequest.brand} ${submittedLead.vehicleRequest.model} (${submittedLead.vehicleRequest.year})`
                        : 'Inmueble (Vivienda / Galpón Comercial visto y confirmado)'}
                    </strong>
                  </div>
                </div>
                <div className="pt-2 border-t border-slate-200 text-[11px] text-slate-500">
                  Sede Oficial Autofin Venezuela: {displayOfficeAddress}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={resetForm}
                  className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors whitespace-nowrap shrink-0"
                >
                  Enviar otra solicitud
                </button>
                {onScrollToCalculator && (
                  <button
                    type="button"
                    onClick={onScrollToCalculator}
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-sky-700 rounded-lg hover:bg-sky-800 transition-colors whitespace-nowrap shrink-0"
                  >
                    <span>Simular cuotas en la Calculadora</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="border-b border-slate-200 pb-4">
                <h2 className="text-xl font-bold text-slate-900">
                  Formulario de Evaluación de Financiamiento
                </h2>
                <p className="text-sm text-slate-500 mt-1">
                  Todos los campos marcados con asterisco (*) son obligatorios.
                </p>
              </div>

              {errorMsg && (
                <div className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">
                  {errorMsg}
                </div>
              )}

              {/* Datos Personales */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    Nombre *
                  </label>
                  <input
                    type="text"
                    required
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="Ej. María Gabriela"
                    className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-600 focus:border-sky-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    Apellido *
                  </label>
                  <input
                    type="text"
                    required
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="Ej. Rivas"
                    className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-600 focus:border-sky-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    Cédula de Identidad *
                  </label>
                  <input
                    type="text"
                    required
                    value={cedula}
                    onChange={(e) => setCedula(e.target.value)}
                    placeholder="Ej. V-24.819.302"
                    className="w-full px-3.5 py-2.5 text-sm font-mono tabular-nums rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-600 focus:border-sky-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    Teléfono (WhatsApp / Móvil) *
                  </label>
                  <input
                    type="tel"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="Ej. +58 412-555-8291"
                    className="w-full px-3.5 py-2.5 text-sm font-mono tabular-nums rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-600 focus:border-sky-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="sm:col-span-1">
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    Correo Electrónico *
                  </label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="cliente@correo.com"
                    className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-600 focus:border-sky-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    Ciudad de Residencia *
                  </label>
                  <select
                    required
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-sky-600 focus:border-sky-600"
                  >
                    {VENEZUELAN_CITIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    Monto Disponible (USD) *
                  </label>
                  <input
                    type="number"
                    min="1"
                    step="0.01"
                    required
                    value={availableAmount}
                    onChange={(e) => setAvailableAmount(e.target.value)}
                    placeholder="Ej. 3500"
                    className="w-full px-3.5 py-2.5 text-sm font-mono tabular-nums rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-600 focus:border-sky-600"
                  />
                </div>
              </div>

              {/* Tipo de Interés (Radio Buttons: Vehículo / Moto / Inmueble) */}
              <div className="pt-2">
                <span className="block text-xs font-medium text-slate-700 mb-2">
                  Tipo de Interés *
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <label
                    className={`flex items-center gap-2.5 p-3.5 rounded-lg border cursor-pointer transition-colors ${
                      interestType === 'vehiculo'
                        ? 'border-sky-700 bg-sky-50/60 text-slate-900'
                        : 'border-slate-200 hover:border-slate-300 text-slate-700'
                    }`}
                  >
                    <input
                      type="radio"
                      name="interestType"
                      value="vehiculo"
                      checked={interestType === 'vehiculo'}
                      onChange={() => handleInterestChange('vehiculo')}
                      className="w-4 h-4 text-sky-700 focus:ring-sky-600"
                    />
                    <Car className="w-4 h-4 text-sky-700 shrink-0" />
                    <div className="text-sm font-medium">Vehículo</div>
                  </label>

                  <label
                    className={`flex items-center gap-2.5 p-3.5 rounded-lg border cursor-pointer transition-colors ${
                      interestType === 'moto'
                        ? 'border-sky-700 bg-sky-50/60 text-slate-900'
                        : 'border-slate-200 hover:border-slate-300 text-slate-700'
                    }`}
                  >
                    <input
                      type="radio"
                      name="interestType"
                      value="moto"
                      checked={interestType === 'moto'}
                      onChange={() => handleInterestChange('moto')}
                      className="w-4 h-4 text-sky-700 focus:ring-sky-600"
                    />
                    <Bike className="w-4 h-4 text-sky-700 shrink-0" />
                    <div className="text-sm font-medium">Moto</div>
                  </label>

                  <label
                    className={`flex items-center gap-2.5 p-3.5 rounded-lg border cursor-pointer transition-colors ${
                      interestType === 'inmueble'
                        ? 'border-sky-700 bg-sky-50/60 text-slate-900'
                        : 'border-slate-200 hover:border-slate-300 text-slate-700'
                    }`}
                  >
                    <input
                      type="radio"
                      name="interestType"
                      value="inmueble"
                      checked={interestType === 'inmueble'}
                      onChange={() => handleInterestChange('inmueble')}
                      className="w-4 h-4 text-sky-700 focus:ring-sky-600"
                    />
                    <Building2 className="w-4 h-4 text-sky-700 shrink-0" />
                    <div className="text-sm font-medium">Inmueble</div>
                  </label>
                </div>
              </div>

              {/* Lógica Condicional Exacta: Vehículo y Moto preguntan los mismos campos */}
              {interestType === 'vehiculo' || interestType === 'moto' ? (
                <div className="p-5 rounded-lg bg-slate-50 border border-slate-200 space-y-4">
                  <h3 className="text-sm font-semibold text-slate-900">
                    {interestType === 'moto'
                      ? 'Especificaciones de la Moto Solicitada'
                      : 'Especificaciones del Vehículo Solicitado'}
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1.5">
                        Condición *
                      </label>
                      <select
                        value={condition}
                        onChange={(e) => setCondition(e.target.value as 'Nuevo' | 'Usado')}
                        className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-sky-600"
                      >
                        <option value="Nuevo">
                          {interestType === 'moto' ? 'Nueva (0 km)' : 'Nuevo (0 km)'}
                        </option>
                        <option value="Usado">
                          {interestType === 'moto' ? 'Usada' : 'Usado'}
                        </option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1.5">
                        Año *
                      </label>
                      <input
                        type="number"
                        min="1995"
                        max="2028"
                        required
                        value={year}
                        onChange={(e) => setYear(e.target.value)}
                        placeholder="Ej. 2026"
                        className="w-full px-3.5 py-2.5 text-sm font-mono tabular-nums rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-sky-600"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1.5">
                        Marca *
                      </label>
                      <input
                        type="text"
                        required
                        value={brand}
                        onChange={(e) => setBrand(e.target.value)}
                        placeholder={
                          interestType === 'moto'
                            ? 'Ej. Empire Keeway, Bera, Suzuki, Yamaha'
                            : 'Ej. Livan, Toyota, Chery, Hyundai'
                        }
                        className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-sky-600"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1.5">
                        Modelo *
                      </label>
                      <input
                        type="text"
                        required
                        value={model}
                        onChange={(e) => setModel(e.target.value)}
                        placeholder={
                          interestType === 'moto'
                            ? 'Ej. RK 200, SBR 150, V-Strom 250'
                            : 'Ej. X3 Pro Automático'
                        }
                        className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-sky-600"
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-5 rounded-lg bg-amber-50/70 border border-amber-200 space-y-3">
                  <p className="text-sm font-medium text-slate-900 leading-relaxed">
                    Para procesar su solicitud de inmueble, usted ya debe tener la propiedad vista y
                    conocer el monto. ¿Confirma que cumple con estos requisitos?
                  </p>
                  <label className="flex items-start gap-3 cursor-pointer pt-1">
                    <input
                      type="checkbox"
                      required
                      checked={propertySeenConfirmed}
                      onChange={(e) => setPropertySeenConfirmed(e.target.checked)}
                      className="mt-0.5 w-4 h-4 rounded border-slate-300 text-sky-700 focus:ring-sky-600"
                    />
                    <span className="text-xs sm:text-sm text-slate-700">
                      Sí, confirmo que ya tengo el inmueble (vivienda o galpón comercial) visto y
                      conozco su monto de venta. *
                    </span>
                  </label>
                </div>
              )}

              <div className="pt-2 flex items-center justify-end">
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full sm:w-auto px-6 py-2.5 text-sm font-semibold text-white bg-sky-700 rounded-lg hover:bg-sky-800 disabled:opacity-60 transition-colors whitespace-nowrap shrink-0"
                >
                  {submitting ? 'Registrando solicitud...' : 'Enviar Solicitud de Financiamiento'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
