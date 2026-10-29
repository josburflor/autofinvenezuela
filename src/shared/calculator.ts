import type { CalculatorSettingsDTO } from './types.ts';

export const DEFAULT_CALCULATOR_SETTINGS: CalculatorSettingsDTO = {
  defaultAssetAmount: 25080,
  baseInstallments: 60,
  adminFee: 330.6,
  planGarantizado1Months: 24,
  planGarantizado2Months: 17,
  planPromoMonths: 4,
  planAhorroMonths: 1,
  fastDelivery1Pct: 55,
  fastDelivery2Pct: 37,
  promo4Plus8Pct: 10,
  ahorroFastPct: 5,
};

export interface InstallmentPlanResult {
  id: string;
  name: string;
  subtitle: string;
  upfrontMonths: number;
  initialPayment: number;
  remainingMonths: number;
  monthlyInstallment: number;
  remainingBalance: number;
  benefitNote: string;
  fitsClientBudget: boolean;
}

export interface FastDeliveryPlanResult {
  id: string;
  name: string;
  initialPercentage: number;
  initialPayment: number;
  financedAmount: number;
  monthlyInstallment: number;
  deliveryWindow: string;
  notes: string;
  fitsClientBudget: boolean;
}

export interface AutofinCalculationSummary {
  totalAmount: number;
  baseInstallments: number;
  monthlyInstallment: number;
  adminFee: number;
  clientAvailableBudget: number;
  classicPlans: InstallmentPlanResult[];
  fastDeliveryPlans: FastDeliveryPlanResult[];
}

export function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function calculateAutofinPlans(
  totalAmount: number,
  settings: CalculatorSettingsDTO = DEFAULT_CALCULATOR_SETTINGS,
  clientAvailableBudget = 0
): AutofinCalculationSummary {
  const safeTotal = Math.max(0, Number.isFinite(totalAmount) ? totalAmount : 0);
  const baseInstallments = Math.max(1, Math.round(settings.baseInstallments || 60));
  const monthlyInstallment = roundCurrency(safeTotal / baseInstallments);
  const adminFee = roundCurrency(settings.adminFee >= 0 ? settings.adminFee : 330.6);

  const buildClassicPlan = (
    id: string,
    name: string,
    subtitle: string,
    upfrontMonths: number,
    benefitNote: string
  ): InstallmentPlanResult => {
    const clampedMonths = Math.min(Math.max(1, upfrontMonths), baseInstallments);
    const initialPayment = roundCurrency(clampedMonths * monthlyInstallment + adminFee);
    const remainingMonths = Math.max(0, baseInstallments - clampedMonths);
    const remainingBalance = roundCurrency(remainingMonths * monthlyInstallment);

    return {
      id,
      name,
      subtitle,
      upfrontMonths: clampedMonths,
      initialPayment,
      remainingMonths,
      monthlyInstallment,
      remainingBalance,
      benefitNote,
      fitsClientBudget: clientAvailableBudget > 0 && clientAvailableBudget >= initialPayment,
    };
  };

  const classicPlans: InstallmentPlanResult[] = [
    buildClassicPlan(
      'garantizada_24',
      `Plan Entrega Garantizada (${settings.planGarantizado1Months} Cuotas)`,
      `${settings.planGarantizado1Months} mensualidades anticipadas + gasto administrativo`,
      settings.planGarantizado1Months,
      `Financiamiento restante en ${Math.max(0, baseInstallments - settings.planGarantizado1Months)} cuotas fijas de $${monthlyInstallment.toFixed(2)}.`
    ),
    buildClassicPlan(
      'garantizada_17',
      `Plan Entrega Garantizada (${settings.planGarantizado2Months} Cuotas)`,
      `${settings.planGarantizado2Months} mensualidades anticipadas + gasto administrativo`,
      settings.planGarantizado2Months,
      `Financiamiento restante en ${Math.max(0, baseInstallments - settings.planGarantizado2Months)} cuotas fijas de $${monthlyInstallment.toFixed(2)}.`
    ),
    buildClassicPlan(
      'promocional_4',
      'Plan Promocional (Tiempo Limitado)',
      `${settings.planPromoMonths} mensualidades anticipadas + gasto administrativo`,
      settings.planPromoMonths,
      `Ingreso promocional sujeto a cupos disponibles; saldo en ${Math.max(0, baseInstallments - settings.planPromoMonths)} cuotas.`
    ),
    buildClassicPlan(
      'plan_ahorro',
      'Plan Ahorro Programado',
      `${settings.planAhorroMonths} mensualidad + gasto administrativo`,
      settings.planAhorroMonths,
      'Participación en sorteos mensuales; entrega garantizada en la cuota 12 (o de 6 a 12 pagos).'
    ),
  ];

  const buildFastPlan = (
    id: string,
    name: string,
    pct: number,
    deliveryWindow: string,
    notes: string
  ): FastDeliveryPlanResult => {
    const initialPayment = roundCurrency((safeTotal * pct) / 100);
    const financedAmount = roundCurrency(Math.max(0, safeTotal - initialPayment));
    const monthlyForRemaining = roundCurrency(financedAmount / baseInstallments);

    return {
      id,
      name,
      initialPercentage: pct,
      initialPayment,
      financedAmount,
      monthlyInstallment: monthlyForRemaining,
      deliveryWindow,
      notes,
      fitsClientBudget: clientAvailableBudget > 0 && clientAvailableBudget >= initialPayment,
    };
  };

  const fastDeliveryPlans: FastDeliveryPlanResult[] = [
    buildFastPlan(
      'rapida_1',
      'Entrega Rápida 1',
      settings.fastDelivery1Pct,
      '25 a 45 días hábiles',
      'Adjudicación directa prioritaria con inicial del 55%.'
    ),
    buildFastPlan(
      'rapida_2',
      'Entrega Rápida 2',
      settings.fastDelivery2Pct,
      '35 a 75 días hábiles',
      'Modalidad intermedia con inicial del 37% y cuotas ajustadas.'
    ),
    buildFastPlan(
      'promo_4_8',
      'Plan Promo 4+8',
      settings.promo4Plus8Pct,
      '25 a 45 días hábiles',
      'Cupos limitados bajo esquema especial 4+8 con 10% de inicial.'
    ),
    buildFastPlan(
      'ahorro_5',
      'Plan Ahorro 5%',
      settings.ahorroFastPct,
      'Cuota 12 puntualmente',
      'Entrega garantizada en la cuota 12 con inicial reducida del 5%.'
    ),
  ];

  return {
    totalAmount: safeTotal,
    baseInstallments,
    monthlyInstallment,
    adminFee,
    clientAvailableBudget,
    classicPlans,
    fastDeliveryPlans,
  };
}

export function formatWhatsAppQuoteMessage(
  clientName: string,
  assetLabel: string,
  summary: AutofinCalculationSummary
): string {
  const fmt = (n: number) =>
    n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const lines = [
    `Hola ${clientName}, un gusto saludarte de parte de *Autofin Venezuela*.`,
    `Te comparto el presupuesto estimado para *${assetLabel}* (Valor referencial: *$${fmt(summary.totalAmount)}* | Base: ${summary.baseInstallments} cuotas de *$${fmt(summary.monthlyInstallment)}*):`,
    '',
    '*PLANES POR CUOTAS (Gasto adm. incluido):*',
    ...summary.classicPlans.map(
      (p) =>
        `• *${p.name}:* Inicial *$${fmt(p.initialPayment)}* | Restan ${p.remainingMonths} cuotas fijas de $${fmt(p.monthlyInstallment)}`
    ),
    '',
    '*MODALIDADES DE ENTREGA RÁPIDA:*',
    ...summary.fastDeliveryPlans.map(
      (f) =>
        `• *${f.name} (${f.initialPercentage}%):* Inicial *$${fmt(f.initialPayment)}* | Entrega: ${f.deliveryWindow}`
    ),
    '',
    '¿Cuál de estas opciones se adapta mejor a tu planificación para agendar tu atención personalizada?',
  ];

  return lines.join('\n');
}
