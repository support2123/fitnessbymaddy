const { supabase } = require('./supabase');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function sendWhatsApp(phone, templateName, params = []) {
  const rateOk = await checkRateLimit(phone);
  if (!rateOk) return { ok: false, reason: 'rate_limited' };

  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone,
    userName: 'FitnessByMaddy',
    templateParams: params,
    source: 'automation'
  };

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const data = await res.json();

  await supabase.from('messages').insert({
    phone: maskPhone(phone),
    direction: 'out',
    body: params.join(' | '),
    template_name: templateName,
    status: res.ok ? 'sent' : 'failed'
  });

  return { ok: res.ok, data };
}

async function checkRateLimit(phone) {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from('messages')
    .select('id')
    .eq('phone', maskPhone(phone))
    .eq('direction', 'out')
    .gte('sent_at', twoHoursAgo);

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

function detectProgram(message) {
  const msg = message.toLowerCase();
  if (/fat\s*loss|weight|shred|burn/.test(msg)) return '6wk_gym';
  if (/pcos|hormonal|hormone/.test(msg)) return 'pcos';
  if (/40|menopause|joints|joint/.test(msg)) return '40plus';
  if (/custom|12\s*week|serious|flagship/.test(msg)) return '12wk';
  if (/trial|zoom|not\s*sure|try/.test(msg)) return 'zoom_trial';
  if (/home|no\s*gym|bodyweight/.test(msg)) return '6wk_home';
  return null;
}

function needsEscalation(message) {
  const msg = message.toLowerCase();
  const triggers = [
    'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
    'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorex', 'bulim',
    'refund', 'lawyer', 'complaint', 'didn\'t work', 'side effect',
    'not working', 'scam'
  ];
  return triggers.some(t => msg.includes(t));
}

function isOptOut(message) {
  const msg = message.toLowerCase().trim();
  return msg === 'stop' || msg === 'unsubscribe' || msg === 'opt out' || msg === 'optout';
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
