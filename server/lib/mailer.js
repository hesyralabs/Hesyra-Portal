// ═══════════════════════════════════════════════════════════════
// MAIL TRANSPORT
//
// Until now this codebase had none: notification preferences existed in
// the UI but nothing could ever be delivered, and the Settings screen
// says so rather than promising mail that never arrives.
//
// This adds a real SMTP sender for the one case that genuinely needs
// it — an admin mailing themselves a case statement. It is configured
// entirely by environment, and when it is NOT configured the callers
// get a clear refusal. It never pretends to have sent anything.
//
// Required in server/.env to enable:
//   SMTP_HOST=smtp.example.com
//   SMTP_PORT=587
//   SMTP_USER=…
//   SMTP_PASS=…
//   SMTP_FROM="Hesyra Labs <cases@hesyralabs.com>"
//   SMTP_SECURE=false      # true for port 465
// ═══════════════════════════════════════════════════════════════
const nodemailer = require('nodemailer');

let cached = null;

function mailConfig() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, SMTP_SECURE } = process.env;
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_FROM) return null;
  return {
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: String(SMTP_SECURE).toLowerCase() === 'true' || Number(SMTP_PORT) === 465,
    ...(SMTP_USER ? { auth: { user: SMTP_USER, pass: SMTP_PASS } } : {}),
    from: SMTP_FROM,
  };
}

/** Whether mail can actually be sent right now. */
function isConfigured() {
  return mailConfig() !== null;
}

function getTransport() {
  const cfg = mailConfig();
  if (!cfg) return null;
  if (!cached) {
    const { from, ...transportCfg } = cfg;
    cached = { transport: nodemailer.createTransport(transportCfg), from };
  }
  return cached;
}

/**
 * Send a mail with optional attachments.
 * Throws a 503-tagged error when no transport is configured, so the
 * route can tell the operator exactly what is missing instead of
 * reporting a success that never happened.
 */
async function sendMail({ to, subject, text, html, attachments = [] }) {
  const t = getTransport();
  if (!t) {
    const err = new Error(
      'Email delivery is not configured on this server. Set SMTP_HOST, SMTP_PORT and SMTP_FROM ' +
      'in server/.env (plus SMTP_USER / SMTP_PASS if your provider needs them) and restart.'
    );
    err.status = 503;
    err.code = 'MAIL_NOT_CONFIGURED';
    throw err;
  }

  return t.transport.sendMail({ from: t.from, to, subject, text, html, attachments });
}

/** Proves the credentials work, without sending anything. */
async function verify() {
  const t = getTransport();
  if (!t) return { configured: false };
  try {
    await t.transport.verify();
    return { configured: true, ok: true, from: t.from };
  } catch (err) {
    return { configured: true, ok: false, error: err.message };
  }
}

module.exports = { sendMail, isConfigured, verify };
