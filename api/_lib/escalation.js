const { getSupabase } = require('./supabase');
const { notifyMaddy } = require('./whatsapp');

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
  'pain', 'dizzy', 'dizziness', 'eating disorder', 'anorexia',
  'bulimia', 'vomit', 'chest pain', 'heart', 'surgery',
  'disordered eating', 'purge', 'faint'
];

const OPT_OUT_KEYWORDS = ['stop', 'unsubscribe', 'opt out', 'optout', 'cancel messages'];

function checkEscalation(text) {
  const lower = text.toLowerCase();

  for (const keyword of ESCALATION_KEYWORDS) {
    if (lower.includes(keyword)) {
      return { shouldEscalate: true, reason: `Message contains: "${keyword}"` };
    }
  }
  return { shouldEscalate: false, reason: null };
}

function checkOptOut(text) {
  const lower = text.toLowerCase().trim();
  return OPT_OUT_KEYWORDS.some(kw => lower === kw || lower.startsWith(kw));
}

async function createEscalation(phone, reason, context) {
  const db = getSupabase();

  await db.from('escalations').insert({
    phone,
    reason,
    context: context ? context.substring(0, 1000) : null
  });

  await notifyMaddy(reason, `Phone: ${phone} | ${context || ''}`);
}

function routeProgram(text) {
  const lower = text.toLowerCase();

  if (/fat\s*loss|weight\s*loss|shred|lean|slim|patla|lose/.test(lower)) {
    return { program: '6wk_gym', name: '6-Week Burn & Build', price: 97 };
  }
  if (/pcos|hormonal|hormone|period|irregular/.test(lower)) {
    return { program: 'pcos', name: 'PCOS Warrior', price: 45 };
  }
  if (/40\+?|forty|menopause|joints|joint\s*pain|aging/.test(lower)) {
    return { program: '40plus', name: '40+ Strong', price: 50 };
  }
  if (/custom|12\s*week|serious|flagship|full|transform/.test(lower)) {
    return { program: '12wk', name: '12-Week Flagship', price: 200 };
  }
  if (/trial|zoom|not\s*sure|try|test|sample/.test(lower)) {
    return { program: 'zoom_trial', name: 'Zoom Trial', price: 20 };
  }
  return null;
}

module.exports = { checkEscalation, checkOptOut, createEscalation, routeProgram };
