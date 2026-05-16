const { supabase } = require('./supabase');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

async function sendWhatsApp(phone, templateName, params = {}, isClient = false) {
  if (!isClient) {
    const canSend = await checkRateLimit(phone);
    if (!canSend) return { success: false, reason: 'rate_limited' };
  }

  const payload = {
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
    body: JSON.stringify(payload)
  });

  const data = await res.json();

  await supabase.from('messages').insert({
    phone: maskPhone(phone),
    direction: 'out',
    body: `Template: ${templateName}`,
    template_name: templateName,
    sent_at: new Date().toISOString(),
    status: res.ok ? 'sent' : 'failed'
  });

  return { success: res.ok, data };
}

async function checkRateLimit(phone) {
  const { data } = await supabase
    .from('messages')
    .select('sent_at')
    .eq('phone', maskPhone(phone))
    .eq('direction', 'out')
    .order('sent_at', { ascending: false })
    .limit(1);

  if (!data || data.length === 0) return true;

  const lastSent = new Date(data[0].sent_at).getTime();
  return (Date.now() - lastSent) >= RATE_LIMIT_MS;
}

function maskPhone(phone) {
  if (!phone || phone.length < 6) return phone;
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

function detectMarket(phone) {
  if (phone.startsWith('+91') || phone.startsWith('91')) return 'IN';
  if (phone.startsWith('+971') || phone.startsWith('971')) return 'UAE';
  if (phone.startsWith('+44') || phone.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

function classifyIntent(message) {
  const msg = message.toLowerCase();
  if (/fat\s*loss|weight|shred|lean/.test(msg)) return '6wk_gym';
  if (/pcos|hormonal|period|irregular/.test(msg)) return 'pcos';
  if (/40|menopause|joint|knee|senior/.test(msg)) return '40plus';
  if (/custom|12\s*week|serious|transform|flagship/.test(msg)) return '12wk';
  if (/trial|zoom|not sure|try|test/.test(msg)) return 'zoom_trial';
  if (/home|no\s*gym|bodyweight/.test(msg)) return '6wk_home';
  return null;
}

const ESCALATION_KEYWORDS = [
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
  'pain', 'dizz', 'eating disorder', 'anorex', 'bulimi',
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'chest pain', 'faint', 'hospital'
];

function needsEscalation(message) {
  const msg = message.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => msg.includes(kw));
}

module.exports = {
  sendWhatsApp,
  checkRateLimit,
  maskPhone,
  detectMarket,
  classifyIntent,
  needsEscalation
};
