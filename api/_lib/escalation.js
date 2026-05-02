const supabase = require('./supabase');
const { sendTemplate, maskPhone } = require('./whatsapp');

const MADDY_PHONE = process.env.MADDY_PHONE || '+917082478374';

const KEYWORDS = {
  medical: ['injury', 'medical', 'pregnant', 'pregnancy', 'medication', 'surgery', 'doctor'],
  distress: ['pain', 'dizzy', 'dizziness', 'eating disorder', 'binge', 'purge', 'faint'],
  business: ['refund', 'lawyer', 'complaint', "didn't work", 'side effect', 'not working'],
};

function findMatchingKeyword(text) {
  const lower = text.toLowerCase();
  for (const category of Object.values(KEYWORDS)) {
    for (const keyword of category) {
      if (lower.includes(keyword)) return keyword;
    }
  }
  return null;
}

async function checkAndEscalate(phone, messageText, sourceType, sourceId) {
  const reason = findMatchingKeyword(messageText);
  if (!reason) return { escalated: false };

  const { error } = await supabase.from('escalations').insert({
    source_type: sourceType,
    source_id: sourceId,
    phone,
    reason,
    details: messageText,
  });

  if (error) console.error('Failed to insert escalation:', error.message);

  const masked = maskPhone(phone);
  await sendTemplate(MADDY_PHONE, 'escalation_alert', [masked, reason]);

  return { escalated: true, reason };
}

module.exports = { checkAndEscalate };
