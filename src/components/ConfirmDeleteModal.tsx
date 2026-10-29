import React, { useEffect, useState } from 'react';
import { AlertTriangle, Trash2, X } from 'lucide-react';
import type { LeadRecordDTO } from '../shared/types';

interface ConfirmDeleteModalProps {
  lead: LeadRecordDTO | null;
  onCancel: () => void;
  onConfirmDelete: (leadId: number) => Promise<void>;
}

function formatRegistrationDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('es-VE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function ConfirmDeleteModal({
  lead,
  onCancel,
  onConfirmDelete,
}: ConfirmDeleteModalProps) {
  const [deleting, setDeleting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    setDeleting(false);
    setErrorMsg(null);
  }, [lead]);

  useEffect(() => {
    if (!lead) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !deleting) {
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [lead, deleting, onCancel]);

  if (!lead) return null;

  const assetDetail =
    (lead.interestType === 'vehiculo' || lead.interestType === 'moto') && lead.vehicleRequest
      ? `${lead.interestType === 'moto' ? 'Moto' : 'Vehículo'}: ${lead.vehicleRequest.brand} ${lead.vehicleRequest.model} (${lead.vehicleRequest.year})`
      : 'Inmueble Comercial / Vivienda';

  const handleConfirm = async () => {
    setDeleting(true);
    setErrorMsg(null);
    try {
      await onConfirmDelete(lead.id);
    } catch (err: unknown) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'No se pudo eliminar el registro de la base de datos.'
      );
      setDeleting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-client-title"
      onClick={() => {
        if (!deleting) onCancel();
      }}
      className="no-print fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-[1px] p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden"
      >
        <div className="px-6 py-5 border-b border-slate-200 flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-red-50 border border-red-200 flex items-center justify-center text-red-700 shrink-0">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h3 id="delete-client-title" className="text-base font-bold text-slate-900">
                Confirmar Eliminación de Cliente
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Esta acción eliminará el expediente de forma permanente en Firebase Cloud Firestore
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={deleting}
            onClick={onCancel}
            aria-label="Cerrar ventana de confirmación"
            className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <p className="text-sm text-slate-700 leading-relaxed">
            ¿Confirma que desea eliminar definitivamente de la base de datos al siguiente cliente y
            todo su historial de llamadas, citas, cotizaciones y archivos adjuntos?
          </p>

          <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 space-y-1.5 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-500">Cliente:</span>
              <strong className="text-sm text-slate-900">
                {lead.firstName} {lead.lastName}
              </strong>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-500">Expediente y Cédula:</span>
              <span className="font-mono tabular-nums font-medium text-slate-800">
                #{lead.id} · {lead.cedula}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-500">Teléfono y Ciudad:</span>
              <span className="font-mono tabular-nums text-slate-800">
                {lead.phone} · {lead.city}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-500">Solicitud:</span>
              <span className="font-medium text-slate-800 text-right">{assetDetail}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-500">Fecha y Hora de Registro:</span>
              <span className="font-mono tabular-nums text-slate-700">
                {formatRegistrationDateTime(lead.createdAt)}
              </span>
            </div>
          </div>

          {errorMsg && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs font-medium text-red-800">
              {errorMsg}
            </div>
          )}
        </div>

        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-end gap-3">
          <button
            type="button"
            disabled={deleting}
            onClick={onCancel}
            className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={deleting}
            onClick={handleConfirm}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-red-700 rounded-lg hover:bg-red-800 disabled:opacity-60 transition-colors whitespace-nowrap shrink-0"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>
              {deleting ? 'Eliminando de Base de Datos...' : 'Sí, Eliminar de Base de Datos'}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
