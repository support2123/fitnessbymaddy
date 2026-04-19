const { supabase } = require('./supabase');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function sendWhatsApp(phone, templateName, params = {}, bodyText = null) {
  const now = new Date();

  const { data: recent } = await supabase
    .from('messages')
    .select('sent_at')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', new Date(now - 2 * 60 * 60 * 1000).toISOString())
    .order('sent_at', { ascending: false })
    .limit(1);

  const { data: lead } = await supabase
    .from('leads')
    .select('status')
    .eq('phone', phone)
    .single();

  const isClient = !lead || lead.status === 'converted';
  if (!isClient && recent && recent.length > 0) {
    return { throttled: true };
  }

  const { data: optOut } = await supabase
    .from('leads')
    .select('status')
    .eq('phone', phone)
    .eq('status', 'dropped')
    .single();

  if (optOut) {
    return { optedOut: true };
  }

  const payload = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone,
    userName: params.name || 'there',
    templateParams: params.templateParams || [],
    source: 'automation',
    ...(bodyText ? { message: bodyText } : {})
  };

  const resp = await fetch(`${AISENSY_API}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const result = await resp.json();

  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body: bodyText || `[template:${templateName}]`,
    template_name: templateName,
    sent_at: now.toISOString(),
    status: resp.ok ? 'sent' : 'failed'
  });

  return { sent: resp.ok, result };
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

const ESCALATION_KEYWORDS = [
  'injury', 'medical', 'pregnant', 'pregnancy', 'medication',
  'pain', 'dizzy', 'dizziness', 'eating disorder', 'anorex', 'bulimi',
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'vomit', 'faint', 'chest pain', 'heart'
];

function needsEscalation(text) {
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

async function notifyMaddy(subject, details) {
  await sendWhatsApp(
    process.env.MADDY_PHONE || '+917082478374',
    'escalation_alert',
    { templateParams: [subject, details] }
  );
}

module.exports = { sendWhatsApp, maskPhone, detectMarket, needsEscalation, notifyMaddy };
