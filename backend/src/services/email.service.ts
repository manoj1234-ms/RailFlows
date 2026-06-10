import nodemailer from 'nodemailer';
import logger from '../utils/logger';

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST;
  if (!host) {
    logger.warn('[Email] SMTP not configured, emails will be logged only');
    return null;
  }

  transporter = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER || '',
      pass: process.env.SMTP_PASS || '',
    },
  });

  return transporter;
}

export interface EmailOptions {
  to: string;
  subject: string;
  text?: string;
  html?: string;
}

export async function sendEmail(options: EmailOptions): Promise<boolean> {
  const t = getTransporter();
  if (!t) {
    logger.info({ msg: '[Email] Logged (no SMTP)', to: options.to, subject: options.subject });
    return true;
  }

  try {
    await t.sendMail({
      from: process.env.SMTP_FROM || 'RailFlow <noreply@railflow.com>',
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html,
    });
    logger.info({ msg: '[Email] Sent', to: options.to, subject: options.subject });
    return true;
  } catch (err: any) {
    logger.error({ msg: '[Email] Failed', to: options.to, error: err.message });
    return false;
  }
}

export async function sendBookingConfirmationEmail(email: string, pnr: string, details: any): Promise<boolean> {
  return sendEmail({
    to: email,
    subject: `Booking Confirmed - PNR: ${pnr}`,
    html: `
      <h1>Booking Confirmed</h1>
      <p>Your booking has been confirmed.</p>
      <p><strong>PNR:</strong> ${pnr}</p>
      <p><strong>Train:</strong> ${details.trainName} (${details.trainNumber})</p>
      <p><strong>Date:</strong> ${details.date}</p>
      <p><strong>Passengers:</strong> ${details.passengerCount}</p>
      <p><strong>Total:</strong> ₹${details.totalPrice}</p>
    `,
  });
}

export async function sendRefundEmail(email: string, pnr: string, amount: number): Promise<boolean> {
  return sendEmail({
    to: email,
    subject: `Refund Processed - PNR: ${pnr}`,
    html: `
      <h1>Refund Processed</h1>
      <p>A refund has been processed for booking ${pnr}.</p>
      <p><strong>Amount:</strong> ₹${amount}</p>
      <p>Please allow 5-7 business days for the amount to reflect in your account.</p>
    `,
  });
}
