const { supabase } = require('./supabase');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function sendWhatsApp(phone, templateName, params = {}) {
  const now = new Date();

  const { data: recent } = await supabase
    .from('messages')
    .select('sent_at')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', new Date(now - 2 * 60 * 60 * 1000).toISOString())
    .order('sent_at', { ascending: false })
    .limit(1);

  if (recent && recent.length > 0) {
    const { data: client } = await supabase
      .from('clients')
      .select('id')
      .eq('phone', phone)
      .eq('status', 'active')
      .single();

    if (!client) {
      console.log(`Rate limited: ${maskPhone(phone)}`);
      return { success: false, reason: 'rate_limited' };
    }
  }

  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone,
    userName: params.name || 'there',
    templateParams: params.templateParams || [],
    media: params.media || {},
    buttons: params.buttons || []
  };

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const result = await res.json();

  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body: templateName,
    template_name: templateName,
    sent_at: now.toISOString(),
    status: res.ok ? 'sent' : 'failed'
  });

  return { success: res.ok, result };
}

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 4) + 'XXX...' + phone.slice(-3);
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
  if (/pcos|hormonal|period|cycle/.test(msg)) return 'pcos';
  if (/40|menopause|joint|senior/.test(msg)) return '40plus';
  if (/custom|12\s*week|serious|transform|flagship/.test(msg)) return '12wk';
  if (/trial|zoom|not\s*sure|try/.test(msg)) return 'zoom_trial';
  if (/home|no\s*gym|bodyweight/.test(msg)) return '6wk_home';
  return null;
}

function needsEscalation(message) {
  const msg = message.toLowerCase();
  const triggers = [
    'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
    'pain', 'dizzy', 'dizziness', 'eating disorder', 'anorex', 'bulimi',
    'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
    'surgery', 'heart', 'diabetes'
  ];
  return triggers.some(t => msg.includes(t));
}

function isOptOut(message) {
  const msg = message.toLowerCase().trim();
  return ['stop', 'unsubscribe', 'opt out', 'opt-out', 'cancel'].includes(msg);
}

module.exports = {
  sendWhatsApp,
  maskPhone,
  detectMarket,
  classifyIntent,
  needsEscalation,
  isOptOut
};
