const { ESCALATION_KEYWORDS } = require('./constants');
const { sendText, maskPhone } = require('./whatsapp');
const { supabase } = require('./supabase');

const MADDY_PHONE = '+917082478374';

function checkEscalation(text) {
  if (!text) return { flagged: false, matches: [] };
  const lower = text.toLowerCase();
  const matches = ESCALATION_KEYWORDS.filter((kw) => lower.includes(kw));
  return { flagged: matches.length > 0, matches };
}

async function notifyMaddy(reason, phone, context) {
  const alert = [
    'ESCALATION ALERT',
    `Reason: ${reason}`,
    `From: ${phone}`,
    `Context: ${context || 'N/A'}`,
    `Time: ${new Date().toISOString()}`
  ].join('\n');

  console.log(`[escalation] Notifying Maddy: ${reason} (from ${maskPhone(phone)})`);

  try {
    await supabase.from('escalations').insert({
      phone,
      type: reason,
      message_excerpt: (context || '').slice(0, 500),
      context,
      status: 'pending'
    });

    const result = await sendText(MADDY_PHONE, alert);
    return { notified: true, result };
  } catch (err) {
    console.error('[escalation] Failed to notify Maddy:', err.message);
    return { notified: false, error: err.message };
  }
}

module.exports = { checkEscalation, notifyMaddy };
