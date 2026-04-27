const { getClient } = require('./supabase');
const { maskPhone } = require('./market');

const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

async function canSendToLead(phone) {
  const db = getClient();

  const { data: lead } = await db
    .from('leads')
    .select('opted_out')
    .eq('phone', phone)
    .single();

  if (lead?.opted_out) return { allowed: false, reason: 'opted_out' };

  const { data: lastMsg } = await db
    .from('messages')
    .select('sent_at')
    .eq('phone', phone)
    .eq('direction', 'out')
    .order('sent_at', { ascending: false })
    .limit(1)
    .single();

  if (lastMsg) {
    const elapsed = Date.now() - new Date(lastMsg.sent_at).getTime();
    if (elapsed < RATE_LIMIT_MS) {
      return { allowed: false, reason: 'rate_limited' };
    }
  }

  return { allowed: true };
}

async function canSendToClient(phone) {
  const db = getClient();
  const { data: lead } = await db
    .from('leads')
    .select('opted_out')
    .eq('phone', phone)
    .single();

  if (lead?.opted_out) return { allowed: false, reason: 'opted_out' };
  return { allowed: true };
}

async function sendTemplate(phone, templateName, params, isClient) {
  const check = isClient
    ? await canSendToClient(phone)
    : await canSendToLead(phone);

  if (!check.allowed) {
    console.log(`Blocked send to ${maskPhone(phone)}: ${check.reason}`);
    return { sent: false, reason: check.reason };
  }

  const apiKey = process.env.AISENSY_API_KEY;
  const res = await fetch('https://backend.aisensy.com/campaign/t1/api/v2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey,
      campaignName: templateName,
      destination: phone,
      userName: 'FitnessByMaddy',
      templateParams: params || [],
    }),
  });

  const result = await res.json();
  await logMessage(phone, 'out', `[template:${templateName}] ${(params || []).join(', ')}`, templateName);
  return { sent: true, result };
}

async function sendText(phone, body, isClient) {
  const check = isClient
    ? await canSendToClient(phone)
    : await canSendToLead(phone);

  if (!check.allowed) {
    console.log(`Blocked send to ${maskPhone(phone)}: ${check.reason}`);
    return { sent: false, reason: check.reason };
  }

  const apiKey = process.env.AISENSY_API_KEY;
  const res = await fetch('https://backend.aisensy.com/campaign/t1/api/v2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey,
      campaignName: 'text_message',
      destination: phone,
      userName: 'FitnessByMaddy',
      message: { type: 'text', text: body },
    }),
  });

  const result = await res.json();
  await logMessage(phone, 'out', body, null);
  return { sent: true, result };
}

async function logMessage(phone, direction, body, templateName) {
  const db = getClient();
  await db.from('messages').insert({
    phone,
    direction,
    body: body?.slice(0, 4000),
    template_name: templateName,
  });
}

module.exports = { sendTemplate, sendText, logMessage, canSendToLead, canSendToClient };
