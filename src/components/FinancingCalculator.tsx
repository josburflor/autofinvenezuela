import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  Calculator,
  Check,
  Copy,
  MessageCircle,
  Save,
  SlidersHorizontal,
} from 'lucide-react';
import {
  calculateAutofinPlans,
  formatWhatsAppQuoteMessage,
  roundCurrency,
} from '../shared/calculator';
import type { CalculatorSettingsDTO, LeadRecordDTO } from '../shared/types';

interface FinancingCalculatorProps {
  settings: CalculatorSettingsDTO;
  canConfigure?: boolean;
  defaultOpenConfig?: boolean;
  onSaveSettings?: (next: CalculatorSettingsDTO) => Promise<void>;
  lead?: LeadRecordDTO | null;
  onSaveQuoteToLead?: (
    totalAmount: number,
    selectedPlanName: string,
    summaryNote: string
  ) => Promise<void>;
  onApplyInitialToForm?: (initialAmount: number, selectedPlanName: string) => void;
}

function formatUsd(val: number): string {
  return val.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function sanitizePhoneForWhatsApp(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.startsWith('0')) {
    return `58${digits.slice(1)}`;
  }
  return digits;
}

export function FinancingCalculator({
  settings,
  canConfigure = false,
  defaultOpenConfig = false,
  onSaveSettings,
  lead = null,
  onSaveQuoteToLead,
  onApplyInitialToForm,
}: FinancingCalculatorProps) {
  const defaultTotal = useMemo(() => {
    if (lead?.vehicleRequest?.estimatedTotalAmount) {
      return Number(lead.vehicleRequest.estimatedTotalAmount);
    }
    if (lead?.propertyRequest?.estimatedPropertyAmount) {
      return Number(lead.propertyRequest.estimatedPropertyAmount);
    }
    return Number(settings.defaultAssetAmount) > 0 ? Number(settings.defaultAssetAmount) : 25080;
  }, [lead, settings.defaultAssetAmount]);

  const [totalAmountInput, setTotalAmountInput] = useState<string>(String(defaultTotal));
  const [monthlyOverrideInput, setMonthlyOverrideInput] = useState<string>(
    String(roundCurrency(defaultTotal / (settings.baseInstallments || 60)))
  );
  const [selectedPlanName, setSelectedPlanName] = useState<string>(
    lead?.vehicleRequest?.selectedPlan ||
      `Plan Entrega Garantizada (${settings.planGarantizado1Months} Cuotas)`
  );
  const [showConfigPanel, setShowConfigPanel] = useState(defaultOpenConfig);
  const [draftSettings, setDraftSettings] = useState<CalculatorSettingsDTO>(settings);
  const [savingSettings, setSavingSettings] = useState(false);
  const [savingQuote, setSavingQuote] = useState(false);
  const [copiedFeedback, setCopiedFeedback] = useState(false);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);

  useEffect(() => {
    setDraftSettings(settings);
  }, [settings]);

  useEffect(() => {
    setTotalAmountInput(String(defaultTotal));
    setMonthlyOverrideInput(
      String(roundCurrency(defaultTotal / (settings.baseInstallments || 60)))
    );
  }, [defaultTotal, settings.baseInstallments]);

  const handleTotalChange = (val: string) => {
    setTotalAmountInput(val);
    const num = Number(val);
    if (Number.isFinite(num) && num >= 0) {
      setMonthlyOverrideInput(
        String(roundCurrency(num / Math.max(1, draftSettings.baseInstallments)))
      );
    }
  };

  const handleMonthlyChange = (val: string) => {
    setMonthlyOverrideInput(val);
    const num = Number(val);
    if (Number.isFinite(num) && num >= 0) {
      setTotalAmountInput(
        String(roundCurrency(num * Math.max(1, draftSettings.baseInstallments)))
      );
    }
  };

  const clientBudget = lead ? Number(lead.availableAmount) || 0 : 0;
  const totalNumeric = Number(totalAmountInput) || 0;

  const summary = useMemo(
    () => calculateAutofinPlans(totalNumeric, draftSettings, clientBudget),
    [totalNumeric, draftSettings, clientBudget]
  );

  const assetLabel = useMemo(() => {
    if (lead?.vehicleRequest) {
      const prefix = lead.interestType === 'moto' ? 'Moto ' : '';
      return `${prefix}${lead.vehicleRequest.brand} ${lead.vehicleRequest.model} ${lead.vehicleRequest.year} (${lead.vehicleRequest.condition})`;
    }
    if (lead?.propertyRequest) {
      return lead.propertyRequest.propertyCategory || 'Inmueble Preseleccionado';
    }
    return 'Vehículo / Moto / Bien Solicitado';
  }, [lead]);

  const whatsappText = useMemo(() => {
    const clientName = lead ? `${lead.firstName} ${lead.lastName}` : 'Estimado(a) cliente';
    return formatWhatsAppQuoteMessage(clientName, assetLabel, summary);
  }, [lead, assetLabel, summary]);

  const handleCopyQuote = async () => {
    try {
      await navigator.clipboard.writeText(whatsappText);
      setCopiedFeedback(true);
      setTimeout(() => setCopiedFeedback(false), 2000);
    } catch {
      setStatusBanner('No se pudo copiar automáticamente al portapapeles.');
    }
  };

  const handlePersistSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onSaveSettings) return;
    setSavingSettings(true);
    setStatusBanner(null);
    try {
      await onSaveSettings(draftSettings);
      if (!defaultOpenConfig) {
        setShowConfigPanel(false);
      }
      setStatusBanner(
        'Parámetros de la calculadora guardados y publicados en Captación Web y CRM.'
      );
      setTimeout(() => setStatusBanner(null), 4000);
    } catch (err: unknown) {
      setStatusBanner(
        err instanceof Error ? err.message : 'Error al guardar parámetros de calculadora.'
      );
    } finally {
      setSavingSettings(false);
    }
  };

  const handleSaveToLead = async () => {
    if (!onSaveQuoteToLead || !lead) return;
    setSavingQuote(true);
    setStatusBanner(null);
    try {
      const note = `Cotización generada por $${formatUsd(summary.totalAmount)} (Base ${summary.baseInstallments} cuotas de $${formatUsd(summary.monthlyInstallment)} + Gasto Adm. $${formatUsd(summary.adminFee)}). Plan seleccionado: ${selectedPlanName}.`;
      await onSaveQuoteToLead(summary.totalAmount, selectedPlanName, note);
      setStatusBanner('Cotización vinculada y registrada en el historial del cliente.');
      setTimeout(() => setStatusBanner(null), 3500);
    } catch (err: unknown) {
      setStatusBanner(
        err instanceof Error ? err.message : 'Error al guardar cotización en ficha.'
      );
    } finally {
      setSavingQuote(false);
    }
  };

  const whatsappUrl = lead
    ? `https://wa.me/${sanitizePhoneForWhatsApp(lead.phone)}?text=${encodeURIComponent(whatsappText)}`
    : `https://wa.me/?text=${encodeURIComponent(whatsappText)}`;

  return (
    <div className="space-y-6">
      {/* Cabecera e Inputs Principales */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
          <div className="flex items-center gap-3">
            <Calculator className="w-5 h-5 text-sky-700 shrink-0" />
            <div>
              <h2 className="text-lg font-bold text-slate-900">
                Calculadora de Planes Autofin Venezuela
              </h2>
              <p className="text-xs text-slate-500">
                Plazo base: {draftSettings.baseInstallments} cuotas · Gasto administrativo: $
                <span className="font-mono tabular-nums">
                  {formatUsd(draftSettings.adminFee)}
                </span>
                {lead && (
                  <>
                    {' '}
                    · Presupuesto disponible del cliente:{' '}
                    <strong className="font-mono tabular-nums text-slate-800">
                      ${formatUsd(clientBudget)}
                    </strong>
                  </>
                )}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {canConfigure && onSaveSettings && (
              <button
                type="button"
                onClick={() => setShowConfigPanel((v) => !v)}
                className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors whitespace-nowrap shrink-0"
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
                <span>{showConfigPanel ? 'Cerrar Parámetros' : 'Configurar Tasas y Cuotas'}</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleCopyQuote}
              className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors whitespace-nowrap shrink-0"
            >
              {copiedFeedback ? (
                <Check className="w-3.5 h-3.5 text-emerald-700" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
              <span>{copiedFeedback ? 'Presupuesto Copiado' : 'Copiar Resumen'}</span>
            </button>

            <a
              href={whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-white bg-emerald-700 rounded-lg hover:bg-emerald-800 transition-colors whitespace-nowrap shrink-0"
            >
              <MessageCircle className="w-3.5 h-3.5" />
              <span>Enviar por WhatsApp</span>
            </a>
          </div>
        </div>

        {statusBanner && (
          <div className="p-3 rounded-lg bg-sky-50 border border-sky-200 text-xs text-sky-900">
            {statusBanner}
          </div>
        )}

        {/* Panel Configurable de Parámetros (Persistencia Cloud SQL) */}
        {showConfigPanel && (
          <form
            onSubmit={handlePersistSettings}
            className="p-5 rounded-lg bg-slate-50 border border-slate-200 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">
                Configuración de Parámetros Globales de la Calculadora
              </h3>
              <span className="text-xs text-slate-500">Se sincroniza en PostgreSQL</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <div>
                <label className="block text-xs text-slate-600 mb-1">Monto Ejemplo ($)</label>
                <input
                  type="number"
                  min="100"
                  step="10"
                  value={draftSettings.defaultAssetAmount ?? 25080}
                  onChange={(e) =>
                    setDraftSettings({
                      ...draftSettings,
                      defaultAssetAmount: Number(e.target.value) || 25080,
                    })
                  }
                  className="w-full px-3 py-2 text-xs font-mono tabular-nums bg-white border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-600 mb-1">Total Cuotas Base</label>
                <input
                  type="number"
                  min="6"
                  max="120"
                  value={draftSettings.baseInstallments}
                  onChange={(e) =>
                    setDraftSettings({
                      ...draftSettings,
                      baseInstallments: Number(e.target.value) || 60,
                    })
                  }
                  className="w-full px-3 py-2 text-xs font-mono tabular-nums bg-white border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-600 mb-1">Gasto Adm. ($)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={draftSettings.adminFee}
                  onChange={(e) =>
                    setDraftSettings({
                      ...draftSettings,
                      adminFee: Number(e.target.value) || 0,
                    })
                  }
                  className="w-full px-3 py-2 text-xs font-mono tabular-nums bg-white border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-600 mb-1">Garantizada 1 (Cuotas)</label>
                <input
                  type="number"
                  min="1"
                  value={draftSettings.planGarantizado1Months}
                  onChange={(e) =>
                    setDraftSettings({
                      ...draftSettings,
                      planGarantizado1Months: Number(e.target.value) || 24,
                    })
                  }
                  className="w-full px-3 py-2 text-xs font-mono tabular-nums bg-white border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-600 mb-1">Garantizada 2 (Cuotas)</label>
                <input
                  type="number"
                  min="1"
                  value={draftSettings.planGarantizado2Months}
                  onChange={(e) =>
                    setDraftSettings({
                      ...draftSettings,
                      planGarantizado2Months: Number(e.target.value) || 17,
                    })
                  }
                  className="w-full px-3 py-2 text-xs font-mono tabular-nums bg-white border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-600 mb-1">Plan Promo (Cuotas)</label>
                <input
                  type="number"
                  min="1"
                  value={draftSettings.planPromoMonths}
                  onChange={(e) =>
                    setDraftSettings({
                      ...draftSettings,
                      planPromoMonths: Number(e.target.value) || 4,
                    })
                  }
                  className="w-full px-3 py-2 text-xs font-mono tabular-nums bg-white border border-slate-300 rounded-lg"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 pt-1">
              <div>
                <label className="block text-xs text-slate-600 mb-1">Plan Ahorro (Cuotas)</label>
                <input
                  type="number"
                  min="1"
                  value={draftSettings.planAhorroMonths}
                  onChange={(e) =>
                    setDraftSettings({
                      ...draftSettings,
                      planAhorroMonths: Number(e.target.value) || 1,
                    })
                  }
                  className="w-full px-3 py-2 text-xs font-mono tabular-nums bg-white border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-600 mb-1">Entrega Rápida 1 (%)</label>
                <input
                  type="number"
                  step="0.5"
                  value={draftSettings.fastDelivery1Pct}
                  onChange={(e) =>
                    setDraftSettings({
                      ...draftSettings,
                      fastDelivery1Pct: Number(e.target.value) || 55,
                    })
                  }
                  className="w-full px-3 py-2 text-xs font-mono tabular-nums bg-white border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-600 mb-1">Entrega Rápida 2 (%)</label>
                <input
                  type="number"
                  step="0.5"
                  value={draftSettings.fastDelivery2Pct}
                  onChange={(e) =>
                    setDraftSettings({
                      ...draftSettings,
                      fastDelivery2Pct: Number(e.target.value) || 37,
                    })
                  }
                  className="w-full px-3 py-2 text-xs font-mono tabular-nums bg-white border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-600 mb-1">Promo 4+8 (%)</label>
                <input
                  type="number"
                  step="0.5"
                  value={draftSettings.promo4Plus8Pct}
                  onChange={(e) =>
                    setDraftSettings({
                      ...draftSettings,
                      promo4Plus8Pct: Number(e.target.value) || 10,
                    })
                  }
                  className="w-full px-3 py-2 text-xs font-mono tabular-nums bg-white border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-600 mb-1">Plan Ahorro (%)</label>
                <input
                  type="number"
                  step="0.5"
                  value={draftSettings.ahorroFastPct}
                  onChange={(e) =>
                    setDraftSettings({
                      ...draftSettings,
                      ahorroFastPct: Number(e.target.value) || 5,
                    })
                  }
                  className="w-full px-3 py-2 text-xs font-mono tabular-nums bg-white border border-slate-300 rounded-lg"
                />
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={savingSettings}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-sky-700 rounded-lg hover:bg-sky-800 disabled:opacity-60 transition-colors whitespace-nowrap shrink-0"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{savingSettings ? 'Guardando...' : 'Guardar Configuración'}</span>
              </button>
            </div>
          </form>
        )}

        {/* Controles Numéricos Interactivos */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              Monto Total del Vehículo / Moto / Bien (USD)
            </label>
            <input
              type="number"
              min="0"
              step="10"
              value={totalAmountInput}
              onChange={(e) => handleTotalChange(e.target.value)}
              className="w-full px-4 py-2.5 text-base font-mono tabular-nums font-semibold text-slate-900 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-600"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              Mensualidad Base ({summary.baseInstallments} cuotas fijas)
            </label>
            <input
              type="number"
              min="0"
              step="1"
              value={monthlyOverrideInput}
              onChange={(e) => handleMonthlyChange(e.target.value)}
              className="w-full px-4 py-2.5 text-base font-mono tabular-nums font-semibold text-slate-900 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-600"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            {[
              { label: 'Moto ($2,280)', val: '2280' },
              { label: 'Ejemplo Livan ($25,080)', val: '25080' },
              { label: 'Compacto ($18,600)', val: '18600' },
              { label: 'SUV ($32,400)', val: '32400' },
            ].map((preset) => (
              <button
                key={preset.val}
                type="button"
                onClick={() => handleTotalChange(preset.val)}
                className="px-3 py-2 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors whitespace-nowrap shrink-0"
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Tabla 1: Planes de Financiamiento por Cuotas Anticipadas */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-base font-bold text-slate-900">
              1. Planes por Mensualidades Anticipadas ({summary.baseInstallments} Cuotas Base)
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Cálculo automático: (Cuotas anticipadas × ${formatUsd(summary.monthlyInstallment)}) +
              Gasto administrativo (${formatUsd(summary.adminFee)})
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                <th className="py-3 px-6">Plan de Financiamiento</th>
                <th className="py-3 px-4 text-right">Pago Inicial</th>
                <th className="py-3 px-4 text-right">Cuotas Restantes</th>
                <th className="py-3 px-4 text-right">Mensualidad Fija</th>
                <th className="py-3 px-6">Condición / Beneficio</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-sm">
              {summary.classicPlans.map((plan) => {
                const isSelected = selectedPlanName === plan.name;
                return (
                  <tr
                    key={plan.id}
                    onClick={() => setSelectedPlanName(plan.name)}
                    className={`cursor-pointer transition-colors ${
                      isSelected ? 'bg-sky-50/70' : 'hover:bg-slate-50'
                    }`}
                  >
                    <td className="py-3.5 px-6">
                      <div className="font-semibold text-slate-900">{plan.name}</div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {plan.subtitle}
                        {lead && plan.fitsClientBudget && (
                          <>
                            {' '}
                            ·{' '}
                            <span className="text-emerald-700 font-medium">
                              Cubierto por presupuesto disponible
                            </span>
                          </>
                        )}
                      </div>
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono tabular-nums font-bold text-slate-900">
                      ${formatUsd(plan.initialPayment)}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono tabular-nums text-slate-700">
                      {plan.remainingMonths} cuotas
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono tabular-nums text-slate-800">
                      ${formatUsd(plan.monthlyInstallment)}
                    </td>
                    <td className="py-3.5 px-6 text-xs text-slate-600 max-w-xs">
                      {plan.benefitNote}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Tabla 2: Planes de Entrega Rápida (Según Porcentaje de Inicial) */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200">
          <h3 className="text-base font-bold text-slate-900">
            2. Modalidades de Entrega Rápida (Esquema Porcentual del Asesor)
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Opciones de adjudicación ágil según porcentaje de inicial sobre el monto total ($
            {formatUsd(summary.totalAmount)})
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                <th className="py-3 px-6">Modalidad</th>
                <th className="py-3 px-4 text-right">% Inicial</th>
                <th className="py-3 px-4 text-right">Monto Inicial</th>
                <th className="py-3 px-4 text-right">Saldo Financiado</th>
                <th className="py-3 px-4">Tiempo de Entrega</th>
                <th className="py-3 px-6">Observaciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-sm">
              {summary.fastDeliveryPlans.map((fast) => {
                const isSelected = selectedPlanName === fast.name;
                return (
                  <tr
                    key={fast.id}
                    onClick={() => setSelectedPlanName(fast.name)}
                    className={`cursor-pointer transition-colors ${
                      isSelected ? 'bg-sky-50/70' : 'hover:bg-slate-50'
                    }`}
                  >
                    <td className="py-3.5 px-6">
                      <div className="font-semibold text-slate-900">{fast.name}</div>
                      {lead && fast.fitsClientBudget && (
                        <div className="text-xs text-emerald-700 font-medium mt-0.5">
                          Cubierto por presupuesto disponible
                        </div>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono tabular-nums text-slate-700">
                      {fast.initialPercentage}%
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono tabular-nums font-bold text-slate-900">
                      ${formatUsd(fast.initialPayment)}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono tabular-nums text-slate-700">
                      ${formatUsd(fast.financedAmount)}
                    </td>
                    <td className="py-3.5 px-4 text-xs font-medium text-slate-800 whitespace-nowrap">
                      {fast.deliveryWindow}
                    </td>
                    <td className="py-3.5 px-6 text-xs text-slate-600 max-w-xs">{fast.notes}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {lead && onSaveQuoteToLead && (
          <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-4">
            <div className="text-xs text-slate-600">
              Plan preseleccionado para el expediente:{' '}
              <strong className="text-slate-900">{selectedPlanName}</strong>
            </div>
            <button
              type="button"
              disabled={savingQuote}
              onClick={handleSaveToLead}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-sky-700 rounded-lg hover:bg-sky-800 disabled:opacity-60 transition-colors whitespace-nowrap shrink-0"
            >
              <Save className="w-3.5 h-3.5" />
              <span>
                {savingQuote ? 'Registrando...' : 'Guardar Cotización en Ficha del Cliente'}
              </span>
            </button>
          </div>
        )}

        {!lead && onApplyInitialToForm && (
          <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-4">
            <div className="text-xs text-slate-600">
              Plan seleccionado: <strong className="text-slate-900">{selectedPlanName}</strong>{' '}
              (clic en cualquier fila arriba para cambiar de plan)
            </div>
            <button
              type="button"
              onClick={() => {
                const matchedClassic = summary.classicPlans.find(
                  (p) => p.name === selectedPlanName
                );
                const matchedFast = summary.fastDeliveryPlans.find(
                  (p) => p.name === selectedPlanName
                );
                const chosenInitial =
                  matchedClassic?.initialPayment ??
                  matchedFast?.initialPayment ??
                  summary.classicPlans[0]?.initialPayment ??
                  0;
                onApplyInitialToForm(roundCurrency(chosenInitial), selectedPlanName);
              }}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-sky-700 rounded-lg hover:bg-sky-800 transition-colors whitespace-nowrap shrink-0"
            >
              <span>Usar Inicial de este Plan en mi Solicitud</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
