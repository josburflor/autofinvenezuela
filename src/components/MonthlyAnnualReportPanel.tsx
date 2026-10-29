import React, { useMemo, useState } from 'react';
import { Download, FileSpreadsheet, Printer, X } from 'lucide-react';
import type {
  AdvisorProfileDTO,
  InterestType,
  LeadRecordDTO,
  LeadStatus,
} from '../shared/types';

interface MonthlyAnnualReportPanelProps {
  leads: LeadRecordDTO[];
  advisorProfile: AdvisorProfileDTO;
  onSelectLead: (leadId: number) => void;
  onClose: () => void;
}

const MONTH_NAMES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

const STATUS_LIST: LeadStatus[] = [
  'Nuevo',
  'Contactado',
  'Cita Presencial',
  'En Financiamiento',
  'Cerrado',
  'Perdido',
];

function formatCurrency(val: number): string {
  return val.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatExactDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('es-VE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function MonthlyAnnualReportPanel({
  leads,
  advisorProfile,
  onSelectLead,
  onClose,
}: MonthlyAnnualReportPanelProps) {
  const now = new Date();

  const availableYears = useMemo(() => {
    const yearSet = new Set<number>([
      now.getFullYear() - 1,
      now.getFullYear(),
      now.getFullYear() + 1,
    ]);
    for (const lead of leads) {
      const d = new Date(lead.createdAt);
      if (!Number.isNaN(d.getTime())) {
        yearSet.add(d.getFullYear());
      }
    }
    return Array.from(yearSet).sort((a, b) => b - a);
  }, [leads, now]);

  // Inicializar en el mes y año del registro más reciente si existe, o la fecha actual
  const initialDate = useMemo(() => {
    if (leads.length > 0) {
      const sorted = [...leads].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      const d = new Date(sorted[0].createdAt);
      if (!Number.isNaN(d.getTime())) return d;
    }
    return new Date();
  }, [leads]);

  const [reportScope, setReportScope] = useState<'monthly' | 'annual'>('monthly');
  const [selectedYear, setSelectedYear] = useState<number>(() => initialDate.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState<number>(() => initialDate.getMonth()); // 0..11
  const [verticalFilter, setVerticalFilter] = useState<'todos' | InterestType>('todos');

  // Clientes filtrados por Mes/Año (o Año completo) + Vertical, ordenados por Fecha y Hora exacta
  const periodLeads = useMemo(() => {
    const filtered = leads.filter((lead) => {
      const d = new Date(lead.createdAt);
      if (Number.isNaN(d.getTime())) return false;
      if (d.getFullYear() !== selectedYear) return false;
      if (reportScope === 'monthly' && d.getMonth() !== selectedMonth) return false;
      if (verticalFilter !== 'todos' && lead.interestType !== verticalFilter) return false;
      return true;
    });

    return filtered.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }, [leads, selectedYear, selectedMonth, reportScope, verticalFilter]);

  // Estadísticas ejecutivas del período
  const stats = useMemo(() => {
    const total = periodLeads.length;
    const fromWeb = periodLeads.filter((l) => l.source === 'Formulario Web').length;
    const totalInitialCapital = periodLeads.reduce(
      (sum, l) => sum + (Number(l.availableAmount) || 0),
      0
    );
    const avgInitialCapital = total > 0 ? totalInitialCapital / total : 0;

    let totalRequestedAssetValue = 0;
    let totalActivitiesCount = 0;
    let scheduledAppointmentsCount = 0;

    for (const l of periodLeads) {
      if (l.vehicleRequest?.estimatedTotalAmount) {
        totalRequestedAssetValue += Number(l.vehicleRequest.estimatedTotalAmount) || 0;
      } else if (l.propertyRequest?.estimatedPropertyAmount) {
        totalRequestedAssetValue += Number(l.propertyRequest.estimatedPropertyAmount) || 0;
      }

      const acts = l.activities || [];
      totalActivitiesCount += acts.length;
      scheduledAppointmentsCount += acts.filter(
        (a) => a.activityType === 'llamada' || a.activityType === 'cita_presencial'
      ).length;
    }

    const byVertical = (['vehiculo', 'moto', 'inmueble'] as InterestType[]).map((type) => {
      const subset = periodLeads.filter((l) => l.interestType === type);
      const capital = subset.reduce((s, l) => s + (Number(l.availableAmount) || 0), 0);
      return {
        type,
        label:
          type === 'vehiculo'
            ? 'Vehículos'
            : type === 'moto'
              ? 'Motos'
              : 'Inmuebles (Vivienda / Comercial)',
        count: subset.length,
        pct: total > 0 ? (subset.length / total) * 100 : 0,
        capital,
      };
    });

    const byStatus = STATUS_LIST.map((st) => {
      const subset = periodLeads.filter((l) => l.status === st);
      const capital = subset.reduce((s, l) => s + (Number(l.availableAmount) || 0), 0);
      return {
        status: st,
        count: subset.length,
        pct: total > 0 ? (subset.length / total) * 100 : 0,
        capital,
      };
    });

    const closedOrFinancing = periodLeads.filter(
      (l) => l.status === 'Cerrado' || l.status === 'En Financiamiento'
    ).length;

    return {
      total,
      fromWeb,
      totalInitialCapital,
      avgInitialCapital,
      totalRequestedAssetValue,
      totalActivitiesCount,
      scheduledAppointmentsCount,
      closedOrFinancing,
      byVertical,
      byStatus,
    };
  }, [periodLeads]);

  // Consolidado de los 12 meses del año seleccionado (para vista anual)
  const monthlyBreakdownForYear = useMemo(() => {
    return MONTH_NAMES.map((monthName, monthIdx) => {
      const monthLeads = leads.filter((l) => {
        const d = new Date(l.createdAt);
        if (Number.isNaN(d.getTime())) return false;
        if (d.getFullYear() !== selectedYear || d.getMonth() !== monthIdx) return false;
        if (verticalFilter !== 'todos' && l.interestType !== verticalFilter) return false;
        return true;
      });

      const vehiculos = monthLeads.filter((l) => l.interestType === 'vehiculo').length;
      const motos = monthLeads.filter((l) => l.interestType === 'moto').length;
      const inmuebles = monthLeads.filter((l) => l.interestType === 'inmueble').length;
      const cerrados = monthLeads.filter(
        (l) => l.status === 'Cerrado' || l.status === 'En Financiamiento'
      ).length;
      const capital = monthLeads.reduce((s, l) => s + (Number(l.availableAmount) || 0), 0);

      return {
        monthIdx,
        monthName,
        total: monthLeads.length,
        vehiculos,
        motos,
        inmuebles,
        cerrados,
        capital,
      };
    });
  }, [leads, selectedYear, verticalFilter]);

  const periodTitle =
    reportScope === 'monthly'
      ? `${MONTH_NAMES[selectedMonth]} ${selectedYear}`
      : `Año Completo ${selectedYear}`;

  const handlePrintReport = () => {
    window.print();
  };

  const handleExportCsv = () => {
    const headers = [
      'Expediente',
      'Fecha y Hora Registro',
      'Nombre',
      'Apellido',
      'Cedula',
      'Telefono',
      'Correo',
      'Ciudad',
      'Vertical',
      'Solicitud Detalle',
      'Monto Disponible USD',
      'Estado',
      'Origen',
    ];

    const escapeCsv = (val: string | number) => {
      const s = String(val ?? '');
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };

    const rows = periodLeads.map((l) => {
      const detail =
        (l.interestType === 'vehiculo' || l.interestType === 'moto') && l.vehicleRequest
          ? `${l.vehicleRequest.brand} ${l.vehicleRequest.model} ${l.vehicleRequest.year} (${l.vehicleRequest.condition})`
          : 'Inmueble visto y confirmado';

      return [
        l.id,
        formatExactDateTime(l.createdAt),
        l.firstName,
        l.lastName,
        l.cedula,
        l.phone,
        l.email,
        l.city,
        l.interestType === 'vehiculo'
          ? 'Vehiculo'
          : l.interestType === 'moto'
            ? 'Moto'
            : 'Inmueble',
        detail,
        Number(l.availableAmount || 0).toFixed(2),
        l.status,
        l.source,
      ]
        .map(escapeCsv)
        .join(',');
    });

    const csvContent = `\uFEFF${[headers.join(','), ...rows].join('\n')}`;
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const slug =
      reportScope === 'monthly'
        ? `${MONTH_NAMES[selectedMonth].toLowerCase()}-${selectedYear}`
        : `anual-${selectedYear}`;
    link.href = url;
    link.download = `resumen-autofin-${slug}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Barra de Controles de Filtro e Impresión (Oculta al imprimir en papel / PDF) */}
      <div className="no-print bg-white rounded-xl border border-slate-200 p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          {/* Selector Alcance: Mensual vs Anual */}
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => setReportScope('monthly')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
                reportScope === 'monthly'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Resumen por Mes y Año
            </button>
            <button
              type="button"
              onClick={() => setReportScope('annual')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
                reportScope === 'annual'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Resumen Anual Completo
            </button>
          </div>

          {/* Selector de Mes */}
          {reportScope === 'monthly' && (
            <div className="flex items-center gap-1.5">
              <label className="text-xs font-medium text-slate-600">Mes:</label>
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(Number(e.target.value))}
                className="px-3 py-2 text-xs font-semibold text-slate-800 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-600"
              >
                {MONTH_NAMES.map((mName, idx) => (
                  <option key={mName} value={idx}>
                    {mName}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Selector de Año */}
          <div className="flex items-center gap-1.5">
            <label className="text-xs font-medium text-slate-600">Año:</label>
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
              className="px-3 py-2 text-xs font-mono tabular-nums font-semibold text-slate-800 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-600"
            >
              {availableYears.map((yr) => (
                <option key={yr} value={yr}>
                  {yr}
                </option>
              ))}
            </select>
          </div>

          {/* Filtro opcional por Vertical */}
          <select
            value={verticalFilter}
            onChange={(e) => setVerticalFilter(e.target.value as 'todos' | InterestType)}
            className="px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-600"
          >
            <option value="todos">Vertical: Todas</option>
            <option value="vehiculo">Solo Vehículos</option>
            <option value="moto">Solo Motos</option>
            <option value="inmueble">Solo Inmuebles</option>
          </select>
        </div>

        {/* Botones de Impresión, Exportación CSV y Cerrar */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={periodLeads.length === 0}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5 text-sky-700" />
            <span>Exportar CSV</span>
          </button>

          <button
            type="button"
            onClick={handlePrintReport}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-sky-700 rounded-lg hover:bg-sky-800 transition-colors whitespace-nowrap shrink-0"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Imprimir Resumen / Guardar PDF</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-800 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors whitespace-nowrap shrink-0"
          >
            <X className="w-3.5 h-3.5" />
            <span>Cerrar</span>
          </button>
        </div>
      </div>

      {/* Documento Ejecutivo Imprimible */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 sm:p-8 space-y-8 print:border-0 print:p-0 print:rounded-none">
        {/* Encabezado Institucional del Reporte */}
        <div className="border-b border-slate-300 pb-6 flex flex-wrap items-start justify-between gap-6">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
              <FileSpreadsheet className="w-4 h-4 text-sky-700 no-print" />
              <span>Autofin Venezuela · Reporte Ejecutivo de Gestión Comercial</span>
            </div>
            <h1 className="text-2xl font-bold text-slate-900">
              Resumen de Captación y Cartera — {periodTitle}
            </h1>
            <p className="text-xs text-slate-600">
              Asesor Titular: <strong className="text-slate-900">{advisorProfile.advisorName}</strong>{' '}
              ({advisorProfile.advisorTitle}) · Sede:{' '}
              <strong className="text-slate-900">
                {advisorProfile.officeAddress || 'CC Salvamall, Valencia, Carabobo, Venezuela'}
              </strong>
              {verticalFilter !== 'todos' && (
                <>
                  {' '}
                  · Filtro aplicado:{' '}
                  <strong className="capitalize text-slate-900">{verticalFilter}</strong>
                </>
              )}
            </p>
          </div>

          <div className="text-xs text-slate-600 sm:text-right font-mono tabular-nums space-y-1">
            <div>Emitido: {formatExactDateTime(new Date().toISOString())}</div>
            <div>Registros en el período: {stats.total}</div>
            <div>Base de financiamiento: 60 cuotas</div>
          </div>
        </div>

        {/* 1. Indicadores Generales del Período */}
        <div className="print-avoid-break grid grid-cols-2 lg:grid-cols-4 border border-slate-200 rounded-lg divide-y lg:divide-y-0 lg:divide-x divide-slate-200">
          <div className="p-4">
            <p className="text-xs text-slate-500 font-medium">Clientes Registrados</p>
            <p className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">
              {stats.total}
            </p>
            <p className="text-xs text-slate-500 mt-1">
              <span className="font-mono tabular-nums">{stats.fromWeb}</span> por Captación Web
            </p>
          </div>

          <div className="p-4">
            <p className="text-xs text-slate-500 font-medium">Capital Inicial Declarado</p>
            <p className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">
              ${formatCurrency(stats.totalInitialCapital)}
            </p>
            <p className="text-xs text-slate-500 mt-1">
              Promedio: ${formatCurrency(stats.avgInitialCapital)}
            </p>
          </div>

          <div className="p-4">
            <p className="text-xs text-slate-500 font-medium">En Financiamiento / Cerrados</p>
            <p className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">
              {stats.closedOrFinancing}
            </p>
            <p className="text-xs text-slate-500 mt-1">
              Efectividad:{' '}
              <span className="font-mono tabular-nums">
                {stats.total > 0 ? ((stats.closedOrFinancing / stats.total) * 100).toFixed(1) : '0.0'}
                %
              </span>
            </p>
          </div>

          <div className="p-4">
            <p className="text-xs text-slate-500 font-medium">Seguimiento Comercial</p>
            <p className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">
              {stats.totalActivitiesCount}
            </p>
            <p className="text-xs text-slate-500 mt-1">
              <span className="font-mono tabular-nums">{stats.scheduledAppointmentsCount}</span>{' '}
              llamadas / citas
            </p>
          </div>
        </div>

        {/* 2. Desglose por Vertical y por Estado Comercial */}
        <div className="print-avoid-break grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Tabla por Vertical */}
          <div className="border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
              <h2 className="text-sm font-bold text-slate-900">
                Distribución por Vertical de Negocio
              </h2>
            </div>
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-600 font-semibold">
                  <th className="py-2.5 px-4">Vertical</th>
                  <th className="py-2.5 px-3 text-right">Clientes</th>
                  <th className="py-2.5 px-3 text-right">%</th>
                  <th className="py-2.5 px-4 text-right">Capital Inicial (USD)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {stats.byVertical.map((row) => (
                  <tr key={row.type}>
                    <td className="py-2.5 px-4 font-medium text-slate-900">{row.label}</td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-800">
                      {row.count}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-600">
                      {row.pct.toFixed(1)}%
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums font-semibold text-slate-900">
                      ${formatCurrency(row.capital)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Tabla por Estado */}
          <div className="border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
              <h2 className="text-sm font-bold text-slate-900">
                Distribución por Estado del Expediente
              </h2>
            </div>
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-600 font-semibold">
                  <th className="py-2.5 px-4">Estado Comercial</th>
                  <th className="py-2.5 px-3 text-right">Clientes</th>
                  <th className="py-2.5 px-3 text-right">%</th>
                  <th className="py-2.5 px-4 text-right">Capital Inicial (USD)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {stats.byStatus.map((row) => (
                  <tr key={row.status}>
                    <td className="py-2.5 px-4 font-medium text-slate-900">{row.status}</td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-800">
                      {row.count}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-600">
                      {row.pct.toFixed(1)}%
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums font-semibold text-slate-900">
                      ${formatCurrency(row.capital)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* 3. Consolidado Mensual Enero-Diciembre (Cuando el alcance es Anual) */}
        {reportScope === 'annual' && (
          <div className="print-avoid-break border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-900">
                Consolidado Mensual del Año {selectedYear}
              </h2>
              <span className="text-xs text-slate-500">Enero a Diciembre</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-600 font-semibold bg-slate-50/60">
                    <th className="py-2.5 px-4">Mes</th>
                    <th className="py-2.5 px-3 text-right">Total Clientes</th>
                    <th className="py-2.5 px-3 text-right">Vehículos</th>
                    <th className="py-2.5 px-3 text-right">Motos</th>
                    <th className="py-2.5 px-3 text-right">Inmuebles</th>
                    <th className="py-2.5 px-3 text-right">En Fin. / Cerrados</th>
                    <th className="py-2.5 px-4 text-right">Capital Inicial (USD)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {monthlyBreakdownForYear.map((m) => (
                    <tr
                      key={m.monthName}
                      onClick={() => {
                        setSelectedMonth(m.monthIdx);
                        setReportScope('monthly');
                      }}
                      title="Clic para abrir el detalle de este mes"
                      className="hover:bg-slate-50 cursor-pointer"
                    >
                      <td className="py-2 px-4 font-medium text-slate-900">{m.monthName}</td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums font-semibold text-slate-900">
                        {m.total}
                      </td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-700">
                        {m.vehiculos}
                      </td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-700">
                        {m.motos}
                      </td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-700">
                        {m.inmuebles}
                      </td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-700">
                        {m.cerrados}
                      </td>
                      <td className="py-2 px-4 text-right font-mono tabular-nums font-semibold text-slate-900">
                        ${formatCurrency(m.capital)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 4. Relación Detallada de Clientes del Período (Ordenada por Fecha y Hora) */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-900">
              Relación Cronológica de Clientes ({periodTitle})
            </h2>
            <span className="text-xs text-slate-500">
              Ordenado por fecha y hora de registro
            </span>
          </div>

          {periodLeads.length === 0 ? (
            <div className="border border-slate-200 rounded-lg p-8 text-center text-sm text-slate-500">
              No existen clientes registrados en {periodTitle} con el criterio seleccionado.
            </div>
          ) : (
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-semibold">
                      <th className="py-2.5 px-3">Fecha y Hora</th>
                      <th className="py-2.5 px-3">Cliente y Cédula</th>
                      <th className="py-2.5 px-3">Contacto / Ciudad</th>
                      <th className="py-2.5 px-3">Vertical y Solicitud</th>
                      <th className="py-2.5 px-3 text-right">Inicial (USD)</th>
                      <th className="py-2.5 px-3">Estado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {periodLeads.map((lead) => {
                      const detail =
                        (lead.interestType === 'vehiculo' || lead.interestType === 'moto') &&
                        lead.vehicleRequest
                          ? `${lead.interestType === 'moto' ? 'Moto' : 'Vehículo'}: ${lead.vehicleRequest.brand} ${lead.vehicleRequest.model} (${lead.vehicleRequest.year})`
                          : 'Inmueble visto y confirmado';

                      return (
                        <tr
                          key={lead.id}
                          onClick={() => onSelectLead(lead.id)}
                          className="print-avoid-break hover:bg-slate-50 cursor-pointer"
                        >
                          <td className="py-2.5 px-3 font-mono tabular-nums text-slate-700 whitespace-nowrap">
                            {formatExactDateTime(lead.createdAt)}
                          </td>
                          <td className="py-2.5 px-3">
                            <div className="font-semibold text-slate-900">
                              {lead.firstName} {lead.lastName}
                            </div>
                            <div className="font-mono tabular-nums text-slate-500">
                              #{lead.id} · {lead.cedula}
                            </div>
                          </td>
                          <td className="py-2.5 px-3">
                            <div className="font-mono tabular-nums text-slate-800">
                              {lead.phone}
                            </div>
                            <div className="text-slate-500">{lead.city}</div>
                          </td>
                          <td className="py-2.5 px-3 text-slate-800">{detail}</td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold text-slate-900 whitespace-nowrap">
                            ${formatCurrency(Number(lead.availableAmount) || 0)}
                          </td>
                          <td className="py-2.5 px-3 font-semibold text-slate-800 whitespace-nowrap">
                            {lead.status}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-slate-300 bg-slate-50 font-bold text-slate-900">
                      <td colSpan={4} className="py-3 px-3 text-right">
                        Total Capital Inicial Declarado ({periodTitle}):
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums">
                        ${formatCurrency(stats.totalInitialCapital)}
                      </td>
                      <td className="py-3 px-3 font-mono tabular-nums">
                        {stats.total} reg.
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Pie de firma para impresión física o PDF */}
        <div className="pt-8 border-t border-slate-200 flex flex-wrap items-end justify-between gap-6 text-xs text-slate-500">
          <div>
            <p className="font-semibold text-slate-800">Autofin Venezuela — Gestión CRM</p>
            <p>Documento administrativo generado desde la base de datos Cloud SQL PostgreSQL.</p>
          </div>
          <div className="sm:text-right">
            <div className="w-52 border-t border-slate-400 pt-1.5 text-slate-800 font-semibold">
              {advisorProfile.advisorName}
            </div>
            <div>{advisorProfile.advisorTitle}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
