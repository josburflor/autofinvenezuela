import nodemailer from 'nodemailer';
import { addLeadActivity, getEmailSettingsRaw } from '../db/repository.ts';
import {
  OFFICIAL_OFFICE_ADDRESS,
  type AdvisorProfileDTO,
  type EmailDeliveryStatusDTO,
} from '../shared/types.ts';

export interface MailLeadRecord {
  id: number;
  firstName: string;
  lastName: string;
  cedula: string;
  phone: string;
  email: string;
  city: string;
  availableAmount: string | number;
  interestType: string;
  createdAt?: Date | string | null;
  vehicleRequest?: {
    condition: string;
    year: number;
    brand: string;
    model: string;
  } | null;
}

function escapeHtml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildClientConfirmationEmail(
  lead: MailLeadRecord,
  advisorProfile: AdvisorProfileDTO
): {
  subject: string;
  text: string;
  html: string;
} {
  const advisorName = advisorProfile.advisorName || 'Jesús Artahona';
  const advisorTitle =
    advisorProfile.advisorTitle || 'Asesor Comercial Oficial · Autofin Venezuela';
  const officeAddress = advisorProfile.officeAddress || OFFICIAL_OFFICE_ADDRESS;

  const formattedBudget = Number(lead.availableAmount || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const isMotorized = lead.interestType === 'vehiculo' || lead.interestType === 'moto';
  const verticalName =
    lead.interestType === 'moto'
      ? 'Financiamiento de Moto'
      : lead.interestType === 'vehiculo'
        ? 'Financiamiento de Vehículo'
        : 'Financiamiento de Inmueble (Vivienda / Galpón Comercial)';

  const requestedDetail =
    isMotorized && lead.vehicleRequest
      ? `${lead.interestType === 'moto' ? 'Moto' : 'Vehículo'} ${lead.vehicleRequest.condition} — Marca: ${lead.vehicleRequest.brand}, Modelo: ${lead.vehicleRequest.model}, Año: ${lead.vehicleRequest.year}`
      : 'Propiedad (vivienda o galpón comercial) ya vista por el solicitante y con monto de venta conocido.';

  const regDate = new Date(lead.createdAt || Date.now()).toLocaleString('es-VE', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const subject = `Confirmación de Solicitud #${lead.id} — Autofin Venezuela (Asesor: ${advisorName})`;

  const text = [
    `Hola ${lead.firstName} ${lead.lastName},`,
    '',
    `Hemos recibido exitosamente tu solicitud #${lead.id} en Autofin Venezuela.`,
    `Tu asesor comercial asignado es ${advisorName} (${advisorTitle}), quien evaluará tu requerimiento y se comunicará contigo muy pronto.`,
    '',
    'RESUMEN DE LOS DATOS Y LO QUE DESEAS FINANCIAR:',
    `- Solicitud N.º: #${lead.id} (${regDate})`,
    `- Nombre completo: ${lead.firstName} ${lead.lastName}`,
    `- Cédula de Identidad: ${lead.cedula}`,
    `- Teléfono / WhatsApp: ${lead.phone}`,
    `- Correo electrónico: ${lead.email}`,
    `- Ciudad de residencia: ${lead.city}`,
    `- Monto inicial / presupuesto disponible: $${formattedBudget} USD`,
    `- Tipo de interés: ${verticalName}`,
    `- Detalle de tu solicitud: ${requestedDetail}`,
    '',
    'NUESTRA SEDE OFICIAL:',
    `${officeAddress}`,
    '',
    `Atentamente,`,
    `${advisorName}`,
    `${advisorTitle}`,
    `Autofin Venezuela — ${officeAddress}`,
  ].join('\n');

  const html = `<!doctype html>
<html lang="es">
  <body style="margin:0;padding:24px;background-color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
      <tr>
        <td style="background:#0f172a;padding:24px 28px;color:#ffffff;">
          <div style="font-size:12px;color:#7dd3fc;font-weight:600;letter-spacing:0.03em;">AUTOFIN VENEZUELA · COMPROBANTE DE SOLICITUD #${lead.id}</div>
          <h1 style="margin:8px 0 0 0;font-size:21px;line-height:1.3;color:#ffffff;">Hola ${escapeHtml(lead.firstName)}, recibimos tu solicitud de financiamiento</h1>
        </td>
      </tr>
      <tr>
        <td style="padding:24px 28px;">
          <p style="margin:0 0 16px 0;font-size:14px;line-height:1.6;color:#334155;">
            Gracias por registrarte en nuestro portal oficial. Tu solicitud ha sido asignada directamente a tu asesor comercial oficial:
          </p>

          <div style="padding:14px 16px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:10px;margin-bottom:20px;">
            <div style="font-size:11px;font-weight:700;color:#0369a1;text-transform:uppercase;">Asesor Asignado</div>
            <div style="font-size:16px;font-weight:700;color:#0f172a;margin-top:2px;">${escapeHtml(advisorName)}</div>
            <div style="font-size:13px;color:#475569;margin-top:2px;">${escapeHtml(advisorTitle)}</div>
          </div>

          <div style="font-size:13px;font-weight:700;color:#0f172a;margin-bottom:10px;">
            Resumen de lo que registraste y deseas financiar:
          </div>

          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e2e8f0;border-radius:8px;border-collapse:collapse;font-size:13px;">
            <tr style="border-bottom:1px solid #e2e8f0;">
              <td style="padding:10px 12px;color:#64748b;width:40%;">Expediente y Fecha</td>
              <td style="padding:10px 12px;color:#0f172a;font-weight:600;">#${lead.id} · ${escapeHtml(regDate)}</td>
            </tr>
            <tr style="border-bottom:1px solid #e2e8f0;background:#f8fafc;">
              <td style="padding:10px 12px;color:#64748b;">Solicitante</td>
              <td style="padding:10px 12px;color:#0f172a;font-weight:600;">${escapeHtml(lead.firstName)} ${escapeHtml(lead.lastName)} (${escapeHtml(lead.cedula)})</td>
            </tr>
            <tr style="border-bottom:1px solid #e2e8f0;">
              <td style="padding:10px 12px;color:#64748b;">Contacto y Ciudad</td>
              <td style="padding:10px 12px;color:#0f172a;">${escapeHtml(lead.phone)} · ${escapeHtml(lead.city)}</td>
            </tr>
            <tr style="border-bottom:1px solid #e2e8f0;background:#f8fafc;">
              <td style="padding:10px 12px;color:#64748b;">Monto Inicial Disponible</td>
              <td style="padding:10px 12px;color:#0f172a;font-weight:700;">$${formattedBudget} USD</td>
            </tr>
            <tr style="border-bottom:1px solid #e2e8f0;">
              <td style="padding:10px 12px;color:#64748b;">Categoría Solicitada</td>
              <td style="padding:10px 12px;color:#0369a1;font-weight:700;">${escapeHtml(verticalName)}</td>
            </tr>
            <tr style="background:#f8fafc;">
              <td style="padding:10px 12px;color:#64748b;">Lo que deseas adquirir</td>
              <td style="padding:10px 12px;color:#0f172a;font-weight:600;">${escapeHtml(requestedDetail)}</td>
            </tr>
          </table>

          <p style="margin:18px 0 0 0;font-size:13px;line-height:1.6;color:#334155;">
            Tu asesor <strong>${escapeHtml(advisorName)}</strong> se pondrá en contacto contigo al número <strong>${escapeHtml(lead.phone)}</strong> para presentarte las opciones de planes a 60 cuotas fijas o modalidades de entrega garantizada adaptadas a tu presupuesto.
          </p>

          <div style="margin-top:20px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b;line-height:1.5;">
            <strong style="color:#0f172a;">Sede Oficial Autofin Venezuela:</strong><br/>
            ${escapeHtml(officeAddress)}
          </div>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, text, html };
}

export async function sendLeadConfirmationEmail(
  lead: MailLeadRecord,
  advisorProfile: AdvisorProfileDTO,
  triggeredByLabel = 'Sistema Automático de Captación Web'
): Promise<EmailDeliveryStatusDTO> {
  const advisorName = advisorProfile.advisorName || 'Jesús Artahona';
  const cfg = await getEmailSettingsRaw();

  if (!cfg.enabled) {
    return {
      attempted: false,
      sent: false,
      recipient: lead.email,
      advisorName,
      message: 'El envío automático de correo se encuentra desactivado en la configuración.',
    };
  }

  if (!cfg.smtpUser || !cfg.smtpPass) {
    return {
      attempted: false,
      sent: false,
      recipient: lead.email,
      advisorName,
      message:
        'Para despachar correos automáticos, configure el correo remitente y su clave de aplicación SMTP en Portal y Calculadora.',
    };
  }

  const { subject, text, html } = buildClientConfirmationEmail(lead, advisorProfile);

  try {
    const transporter = nodemailer.createTransport({
      host: cfg.smtpHost,
      port: cfg.smtpPort,
      secure: cfg.smtpSecure,
      auth: {
        user: cfg.smtpUser,
        pass: cfg.smtpPass,
      },
    });

    const bccList =
      cfg.sendCopyToAdvisor && cfg.advisorNotifyEmail && cfg.advisorNotifyEmail !== lead.email
        ? cfg.advisorNotifyEmail
        : undefined;

    await transporter.sendMail({
      from: `"${cfg.senderName.replace(/"/g, '')}" <${cfg.smtpUser}>`,
      to: lead.email,
      replyTo: cfg.replyToEmail || cfg.smtpUser,
      bcc: bccList,
      subject,
      text,
      html,
    });

    await addLeadActivity({
      leadId: lead.id,
      advisorName: triggeredByLabel,
      activityType: 'correo',
      title: `Confirmación enviada por correo a ${lead.email}`,
      description: `Se envió el comprobante de la solicitud #${lead.id} con el detalle requerido por el cliente, sede oficial (${advisorProfile.officeAddress || OFFICIAL_OFFICE_ADDRESS}) y asignación al asesor ${advisorName}.`,
      completed: true,
    });

    return {
      attempted: true,
      sent: true,
      recipient: lead.email,
      advisorName,
      message: `Correo de confirmación enviado exitosamente a ${lead.email}.`,
    };
  } catch (error: unknown) {
    console.error('Failed to send client confirmation email:', error);
    const errMsg = error instanceof Error ? error.message : 'Error de conexión SMTP';
    return {
      attempted: true,
      sent: false,
      recipient: lead.email,
      advisorName,
      message: `No se pudo entregar el correo vía SMTP (${errMsg}). Revise las credenciales SMTP en el Panel Administrativo.`,
    };
  }
}

export async function sendTestSmtpEmail(
  recipientEmail: string,
  advisorProfile: AdvisorProfileDTO
): Promise<{ sent: boolean; message: string }> {
  const cfg = await getEmailSettingsRaw();
  if (!cfg.smtpUser || !cfg.smtpPass) {
    throw new Error(
      'Primero guarde el Correo Remitente (Usuario SMTP) y la Clave de Aplicación SMTP antes de enviar una prueba.'
    );
  }

  const sampleLead: MailLeadRecord = {
    id: 1001,
    firstName: 'Cliente de',
    lastName: 'Prueba',
    cedula: 'V-20.123.456',
    phone: '+58 412-555-0199',
    email: recipientEmail.trim(),
    city: 'Valencia',
    availableAmount: '4500.00',
    interestType: 'vehiculo',
    createdAt: new Date().toISOString(),
    vehicleRequest: {
      condition: 'Nuevo',
      year: new Date().getFullYear(),
      brand: 'Livan',
      model: 'X3 Pro Automático',
    },
  };

  const { subject, text, html } = buildClientConfirmationEmail(sampleLead, advisorProfile);

  const transporter = nodemailer.createTransport({
    host: cfg.smtpHost,
    port: cfg.smtpPort,
    secure: cfg.smtpSecure,
    auth: {
      user: cfg.smtpUser,
      pass: cfg.smtpPass,
    },
  });

  await transporter.sendMail({
    from: `"${cfg.senderName.replace(/"/g, '')}" <${cfg.smtpUser}>`,
    to: recipientEmail.trim(),
    replyTo: cfg.replyToEmail || cfg.smtpUser,
    subject: `[PRUEBA] ${subject}`,
    text,
    html,
  });

  return {
    sent: true,
    message: `Correo de prueba enviado correctamente a ${recipientEmail.trim()} nombrando a ${advisorProfile.advisorName}.`,
  };
}
