const { getSupabase } = require('./supabase');

const AISENSY_BASE = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function sendWhatsApp(phone, templateName, params = []) {
  const db = getSupabase();

  const rateCheck = await db
    .from('messages')
    .select('sent_at')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString())
    .order('sent_at', { ascending: false })
    .limit(1);

  if (rateCheck.data && rateCheck.data.length > 0) {
    const lead = await db.from('leads').select('status').eq('phone', phone).single();
    const client = await db.from('clients').select('status').eq('phone', phone).single();
    if (!client.data || client.data.status !== 'active') {
      return { skipped: true, reason: 'rate_limited' };
    }
  }

  const res = await fetch(AISENSY_BASE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.AISENSY_API_KEY}`
    },
    body: JSON.stringify({
      apiKey: process.env.AISENSY_API_KEY,
      campaignName: templateName,
      destination: phone,
      userName: 'FitnessByMaddy',
      templateParams: params,
      media: {}
    })
  });

  const result = await res.json();

  await db.from('messages').insert({
    phone: phone,
    direction: 'out',
    body: `Template: ${templateName} | Params: ${JSON.stringify(params)}`,
    template_name: templateName,
    sent_at: new Date().toISOString(),
    status: res.ok ? 'sent' : 'failed'
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

function detectProgram(text) {
  const lower = (text || '').toLowerCase();
  if (/fat\s*loss|weight|shred|lean/.test(lower)) return '6wk_gym';
  if (/pcos|hormonal|period|cycle/.test(lower)) return 'pcos';
  if (/40|menopause|joint|knee/.test(lower)) return '40plus';
  if (/custom|12\s*week|serious|flagship/.test(lower)) return '12wk';
  if (/home|no\s*gym|bodyweight/.test(lower)) return '6wk_home';
  if (/trial|zoom|not\s*sure|try/.test(lower)) return 'zoom_trial';
  return null;
}

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', 'didn\'t work', 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'pain',
  'dizzy', 'dizziness', 'eating disorder', 'purge', 'binge'
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
  maskPhone,
  detectMarket,
  detectProgram,
  needsEscalation,
  isOptOut
};
