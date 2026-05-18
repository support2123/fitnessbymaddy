const { supabase } = require('./supabase');
const { maskPhone } = require('./market');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

async function canSendToLead(phone) {
  const { data } = await supabase
    .from('messages')
    .select('sent_at')
    .eq('phone', phone)
    .eq('direction', 'out')
    .order('sent_at', { ascending: false })
    .limit(1);

  if (!data || data.length === 0) return true;
  const lastSent = new Date(data[0].sent_at).getTime();
  return Date.now() - lastSent > RATE_LIMIT_MS;
}

async function sendTemplate(phone, templateName, params = []) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) throw new Error('AISENSY_API_KEY not configured');

  const body = {
    apiKey,
    campaignName: templateName,
    destination: phone.replace('+', ''),
    userName: 'FitnessByMaddy',
    templateParams: params,
    source: 'automation',
    media: {},
    buttons: [],
    carouselCards: [],
    location: {}
  };

  const res = await fetch(`${AISENSY_API}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const result = await res.json();

  await logMessage(phone, 'out', `[template:${templateName}] ${params.join(', ')}`, templateName);

  return result;
}

async function sendText(phone, text) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) throw new Error('AISENSY_API_KEY not configured');

  const body = {
    apiKey,
    campaignName: 'text_message',
    destination: phone.replace('+', ''),
    userName: 'FitnessByMaddy',
    message: { text },
    source: 'automation'
  };

  const res = await fetch(`${AISENSY_API}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const result = await res.json();
  await logMessage(phone, 'out', text, null);
  return result;
}

async function sendDocument(phone, pdfUrl, caption) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) throw new Error('AISENSY_API_KEY not configured');

  const body = {
    apiKey,
    campaignName: 'program_delivery',
    destination: phone.replace('+', ''),
    userName: 'FitnessByMaddy',
    media: { url: pdfUrl, filename: 'program.pdf' },
    templateParams: [caption || 'Your weekly program'],
    source: 'automation'
  };

  const res = await fetch(`${AISENSY_API}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const result = await res.json();
  await logMessage(phone, 'out', `[pdf] ${caption || pdfUrl}`, 'program_delivery');
  return result;
}

async function notifyMaddy(subject, details) {
  const maddyPhone = process.env.MADDY_PHONE || '+917082478374';
  const text = `🚨 ESCALATION: ${subject}\n\n${details}`;
  return sendText(maddyPhone, text);
}

async function logMessage(phone, direction, body, templateName) {
  await supabase.from('messages').insert({
    phone,
    direction,
    body: body?.slice(0, 500),
    template_name: templateName,
    sent_at: new Date().toISOString(),
    status: 'sent'
  });
}

module.exports = {
  canSendToLead,
  sendTemplate,
  sendText,
  sendDocument,
  notifyMaddy,
  logMessage
};
