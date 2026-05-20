const { getSupabase } = require('./supabase');

const AISENSY_BASE = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function sendWhatsApp(phone, templateName, params = []) {
  const db = getSupabase();

  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const { data: recent } = await db
    .from('messages')
    .select('id')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', twoHoursAgo)
    .limit(1);

  const { data: lead } = await db
    .from('leads')
    .select('status')
    .eq('phone', phone)
    .single();

  if (lead && lead.status === 'dropped') {
    return { skipped: true, reason: 'opted-out' };
  }

  const isClient = await db
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .eq('status', 'active')
    .limit(1);

  const isOptedIn = isClient.data && isClient.data.length > 0;

  if (!isOptedIn && recent && recent.length > 0) {
    return { skipped: true, reason: 'rate-limited' };
  }

  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone,
    userName: 'FitnessByMaddy',
    templateParams: params,
  };

  const resp = await fetch(AISENSY_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const result = await resp.json();

  await db.from('messages').insert({
    phone,
    direction: 'out',
    body: `[template: ${templateName}] ${params.join(', ')}`,
    template_name: templateName,
    sent_at: new Date().toISOString(),
    status: resp.ok ? 'sent' : 'failed',
  });

  return result;
}

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

function detectMarket(phone) {
  if (phone.startsWith('+91') || phone.startsWith('91')) return 'IN';
  if (phone.startsWith('+971') || phone.startsWith('971')) return 'UAE';
  if (phone.startsWith('+44') || phone.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

function routeProgram(text) {
  const lower = (text || '').toLowerCase();
  if (/fat\s*loss|weight|shred|burn/.test(lower)) return '6wk_gym';
  if (/pcos|hormonal|hormone/.test(lower)) return 'pcos';
  if (/40|menopause|joints|joint/.test(lower)) return '40plus';
  if (/custom|12\s*week|serious|flagship/.test(lower)) return '12wk';
  if (/home|bodyweight|no\s*gym/.test(lower)) return '6wk_home';
  if (/trial|zoom|not\s*sure|try/.test(lower)) return 'zoom_trial';
  return null;
}

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'pain',
  'dizzy', 'dizziness', 'eating disorder', 'not eating',
  'medical', 'surgery', 'doctor',
];

function needsEscalation(text) {
  const lower = (text || '').toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function notifyMaddy(reason, details) {
  await sendWhatsApp(
    process.env.MADDY_PHONE || '+917082478374',
    'escalation_alert',
    [reason, details]
  );
}

module.exports = {
  sendWhatsApp,
  maskPhone,
  detectMarket,
  routeProgram,
  needsEscalation,
  notifyMaddy,
};
