const { supabase } = require('./supabase');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function sendWhatsApp(phone, templateName, params = {}) {
  const rateOk = await checkRateLimit(phone);
  if (!rateOk) return { sent: false, reason: 'rate_limited' };

  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone,
    userName: params.name || 'there',
    templateParams: params.templateParams || [],
    media: params.media || {}
  };

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const result = await res.json();

  await supabase.from('messages').insert({
    phone: maskPhone(phone),
    direction: 'out',
    body: templateName,
    template_name: templateName,
    sent_at: new Date().toISOString(),
    status: res.ok ? 'sent' : 'failed'
  });

  return { sent: res.ok, result };
}

async function checkRateLimit(phone) {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from('messages')
    .select('id')
    .eq('phone', maskPhone(phone))
    .eq('direction', 'out')
    .gte('sent_at', twoHoursAgo)
    .limit(1);

  return !data || data.length === 0;
}

function maskPhone(phone) {
  if (!phone || phone.length < 6) return phone;
  return phone.slice(0, 4) + 'XXX...' + phone.slice(-3);
}

function detectMarket(phone) {
  if (phone.startsWith('+91') || phone.startsWith('91')) return 'IN';
  if (phone.startsWith('+971') || phone.startsWith('971')) return 'UAE';
  if (phone.startsWith('+44') || phone.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

function detectProgram(text) {
  const lower = (text || '').toLowerCase();
  if (/fat\s*loss|weight|shred|lean/.test(lower)) return '6wk_gym';
  if (/pcos|hormonal|period/.test(lower)) return 'pcos';
  if (/40|menopause|joint|senior/.test(lower)) return '40plus';
  if (/custom|12\s*week|serious|flagship/.test(lower)) return '12wk';
  if (/home|no\s*gym|bodyweight/.test(lower)) return '6wk_home';
  if (/trial|zoom|not\s*sure|try/.test(lower)) return 'zoom_trial';
  return null;
}

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', 'didn\'t work', 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'pain',
  'dizzy', 'dizziness', 'eating disorder', 'anorex', 'bulimi'
];

function needsEscalation(text) {
  const lower = (text || '').toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function isOptOut(text) {
  const lower = (text || '').toLowerCase().trim();
  return lower === 'stop' || lower === 'unsubscribe' || lower === 'opt out';
}

module.exports = {
  sendWhatsApp,
  checkRateLimit,
  maskPhone,
  detectMarket,
  detectProgram,
  needsEscalation,
  isOptOut
};
