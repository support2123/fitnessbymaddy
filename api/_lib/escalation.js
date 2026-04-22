const { sendTemplate } = require('./whatsapp');
const { maskPhone } = require('./whatsapp');

const MADDY_PHONE = process.env.MADDY_PHONE || '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizziness', 'dizzy', 'faint', 'eating disorder',
  'anorexia', 'bulimia', 'vomit', 'chest pain', 'heart',
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some((kw) => lower.includes(kw));
}

async function escalateToMaddy(reason, context) {
  const msg = `ESCALATION: ${reason}\nPhone: ${maskPhone(context.phone)}\nMessage: ${context.text || 'N/A'}`;
  await sendTemplate(MADDY_PHONE, 'escalation_alert', [reason, maskPhone(context.phone)]);
  return msg;
}

function classifyIntent(text) {
  if (!text) return null;
  const lower = text.toLowerCase();

  if (/\b(stop|unsubscribe|opt.?out)\b/i.test(lower)) return 'OPT_OUT';

  if (/\b(fat.?loss|weight|shred|lean|cut|slim)\b/i.test(lower)) return '6wk_gym';
  if (/\b(pcos|hormonal|hormone|period|irregular)\b/i.test(lower)) return 'pcos';
  if (/\b(40|forty|menopause|joint|joints|senior)\b/i.test(lower)) return '40plus';
  if (/\b(custom|12.?week|serious|flagship|personal)\b/i.test(lower)) return '12wk';
  if (/\b(trial|zoom|not sure|try|test)\b/i.test(lower)) return 'zoom_trial';
  if (/\b(home|no.?gym|body.?weight|at.?home)\b/i.test(lower)) return '6wk_home';

  return null;
}

module.exports = { needsEscalation, escalateToMaddy, classifyIntent, ESCALATION_KEYWORDS };
