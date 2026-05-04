const { supabase } = require('./supabase');

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

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
  return Date.now() - lastSent >= RATE_LIMIT_MS;
}

async function isOptedOut(phone) {
  const { data } = await supabase
    .from('leads')
    .select('status')
    .eq('phone', phone)
    .eq('status', 'dropped')
    .limit(1);

  return data && data.length > 0;
}

async function sendTemplate(phone, templateName, params = []) {
  if (await isOptedOut(phone)) {
    console.log(`Blocked send to opted-out number ${maskPhone(phone)}`);
    return { blocked: true, reason: 'opted_out' };
  }

  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: templateName,
    destination: phone,
    userName: 'FitnessByMaddy',
    templateParams: params,
    source: 'automation',
    media: {},
    buttons: [],
    carouselCards: [],
    location: {}
  };

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const result = await res.json();

  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body: `[template:${templateName}] ${params.join(', ')}`,
    template_name: templateName,
    status: res.ok ? 'sent' : 'failed'
  });

  return result;
}

async function sendTextMessage(phone, text) {
  if (await isOptedOut(phone)) {
    console.log(`Blocked send to opted-out number ${maskPhone(phone)}`);
    return { blocked: true, reason: 'opted_out' };
  }

  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'text_message',
    destination: phone,
    userName: 'FitnessByMaddy',
    message: { type: 'text', text },
    source: 'automation'
  };

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body: text,
    status: res.ok ? 'sent' : 'failed'
  });

  return res.json();
}

async function sendDocument(phone, documentUrl, caption) {
  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: 'document_message',
    destination: phone,
    userName: 'FitnessByMaddy',
    media: { url: documentUrl, filename: 'program.pdf' },
    message: { type: 'document', caption },
    source: 'automation'
  };

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body: `[document] ${caption}`,
    status: res.ok ? 'sent' : 'failed'
  });

  return res.json();
}

module.exports = {
  sendTemplate,
  sendTextMessage,
  sendDocument,
  canSendToLead,
  isOptedOut,
  maskPhone
};
