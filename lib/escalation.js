const { supabase } = require('./supabase');
const { sendTemplate } = require('./whatsapp');
const { maskPhone } = require('./market');

const MADDY_PHONE = '+917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizziness', 'dizzy', 'faint', 'eating disorder',
  'anorexia', 'bulimia', 'purge', 'not eating'
];

function checkEscalation(messageBody) {
  if (!messageBody) return null;
  const lower = messageBody.toLowerCase();
  return ESCALATION_KEYWORDS.find(kw => lower.includes(kw)) || null;
}

async function triggerEscalation(phone, triggerKeyword, messageBody) {
  await supabase.from('escalations').insert({
    phone,
    trigger_keyword: triggerKeyword,
    message_body: messageBody
  });

  await sendTemplate(MADDY_PHONE, 'escalation_alert', [
    maskPhone(phone),
    triggerKeyword,
    (messageBody || '').slice(0, 200)
  ]);

  console.log(`ESCALATION: ${maskPhone(phone)} triggered on "${triggerKeyword}"`);
}

function routeProgram(messageBody) {
  if (!messageBody) return null;
  const lower = messageBody.toLowerCase();

  if (/fat\s*loss|weight|shred|lean/.test(lower)) return '6wk_gym';
  if (/pcos|hormonal|hormone/.test(lower)) return 'pcos';
  if (/40\+?|menopause|joints|joint/.test(lower)) return '40plus';
  if (/custom|12\s*week|serious|flagship/.test(lower)) return '12wk';
  if (/trial|zoom|not\s*sure|try/.test(lower)) return 'zoom_trial';
  if (/home|no\s*gym|bodyweight/.test(lower)) return '6wk_home';

  return null;
}

function isOptOut(messageBody) {
  if (!messageBody) return false;
  const lower = messageBody.trim().toLowerCase();
  return ['stop', 'unsubscribe', 'opt out', 'opt-out', 'cancel'].includes(lower);
}

module.exports = { checkEscalation, triggerEscalation, routeProgram, isOptOut };
