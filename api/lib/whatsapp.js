import supabase from './supabase.js';

const AISENSY_API = 'https://backend.aisensy.com/campaign/t1/api/v2';

async function logMessage(phone, direction, body, templateName, status) {
  await supabase.from('messages').insert({
    phone,
    direction,
    body: body?.slice(0, 2000),
    template_name: templateName,
    status,
  });
}

async function checkRateLimit(phone) {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const { count } = await supabase
    .from('messages')
    .select('*', { count: 'exact', head: true })
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', twoHoursAgo);

  return (count || 0) >= 1;
}

async function isOptedInClient(phone) {
  const { data } = await supabase
    .from('clients')
    .select('id, status')
    .eq('phone', phone)
    .eq('status', 'active')
    .limit(1);
  return data && data.length > 0;
}

export async function sendTemplate(phone, templateName, params = []) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) throw new Error('AISENSY_API_KEY not configured');

  const body = {
    apiKey,
    campaignName: templateName,
    destination: phone,
    userName: 'FitnessByMaddy',
    templateParams: params,
    source: 'automation',
  };

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const result = await res.json();
  await logMessage(phone, 'out', `[template:${templateName}] ${params.join(', ')}`, templateName, res.ok ? 'sent' : 'failed');
  return result;
}

export async function sendText(phone, message, skipRateLimit = false) {
  if (!skipRateLimit) {
    const isClient = await isOptedInClient(phone);
    if (!isClient) {
      const rateLimited = await checkRateLimit(phone);
      if (rateLimited) return { skipped: true, reason: 'rate_limited' };
    }
  }

  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) throw new Error('AISENSY_API_KEY not configured');

  const body = {
    apiKey,
    campaignName: 'text_message',
    destination: phone,
    userName: 'FitnessByMaddy',
    message: { type: 'text', text: message },
    source: 'automation',
  };

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const result = await res.json();
  await logMessage(phone, 'out', message, null, res.ok ? 'sent' : 'failed');
  return result;
}

export async function sendMediaMessage(phone, mediaUrl, caption) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) throw new Error('AISENSY_API_KEY not configured');

  const body = {
    apiKey,
    campaignName: 'media_message',
    destination: phone,
    userName: 'FitnessByMaddy',
    media: { url: mediaUrl, filename: 'program.pdf' },
    message: { type: 'document', text: caption || '' },
    source: 'automation',
  };

  const res = await fetch(AISENSY_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const result = await res.json();
  await logMessage(phone, 'out', `[media] ${caption || mediaUrl}`, null, res.ok ? 'sent' : 'failed');
  return result;
}
