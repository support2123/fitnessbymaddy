const { sendTemplate } = require('./whatsapp');
const { maskPhone } = require('./helpers');

const MADDY_PHONE = '+917082478374';

async function notifyMaddy(reason, details) {
  const msg = `${reason}: ${details.name || 'Unknown'} (${maskPhone(details.phone || '')})`;
  console.log(`[ESCALATION] ${msg}`);
  await sendTemplate(MADDY_PHONE, 'escalation_alert', [reason, details.name || 'Unknown', details.phone || '']);
}

async function checkAndEscalate(text, leadOrClient) {
  const { needsEscalation } = require('./helpers');
  if (!needsEscalation(text)) return false;

  const triggers = [];
  const lower = text.toLowerCase();
  if (lower.includes('refund')) triggers.push('Refund request');
  if (lower.includes('pain') || lower.includes('dizziness')) triggers.push('Health concern reported');
  if (lower.includes('injury')) triggers.push('Injury mentioned');
  if (lower.includes('pregnan')) triggers.push('Pregnancy mentioned');
  if (lower.includes('lawyer') || lower.includes('complaint')) triggers.push('Legal/complaint');
  if (lower.includes('medication') || lower.includes('medical')) triggers.push('Medical condition');
  if (lower.includes('eating disorder') || lower.includes('anorex') || lower.includes('bulimi') || lower.includes('not eating'))
    triggers.push('Disordered eating signals');

  const reason = triggers.length > 0 ? triggers.join(', ') : 'Flagged message';
  await notifyMaddy(reason, leadOrClient);
  return true;
}

async function escalateMissedCheckins(client) {
  await notifyMaddy('2 consecutive missed check-ins', client);
}

async function escalatePaymentFailure(client) {
  await notifyMaddy('Payment failure for active client', client);
}

module.exports = { notifyMaddy, checkAndEscalate, escalateMissedCheckins, escalatePaymentFailure };
