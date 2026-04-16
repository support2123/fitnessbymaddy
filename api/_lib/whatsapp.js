import { supa } from './supabase.js';
import { maskPhone, normalizePhone } from './mask.js';

const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

// AiSensy generic campaign send (v2). Docs: https://docs.aisensy.com
async function sendViaAiSensy({ to, templateName, params = [], body }) {
  const key = process.env.AISENSY_API_KEY;
  const base = process.env.AISENSY_API_BASE || 'https://backend.aisensy.com';
  if (!key) throw new Error('AISENSY_API_KEY missing');

  const payload = {
    apiKey: key,
    campaignName: templateName || 'session_message',
    destination: to,
    userName: 'FitnessByMaddy',
    templateParams: params,
    source: 'automation'
  };
  if (body) payload.message = body;

  const res = await fetch(`${base}/campaign/t1/api/v2`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!res.ok) throw new Error(`AiSensy ${res.status}: ${await res.text()}`);
  return res.json();
}

// Meta Cloud API fallback (text only for opt-out/within-24h session)
async function sendViaMeta({ to, body }) {
  const token = process.env.META_WA_TOKEN;
  const phoneId = process.env.META_WA_PHONE_ID;
  if (!token || !phoneId) throw new Error('Meta WA env vars missing');

  const res = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body }
    })
  });

  if (!res.ok) throw new Error(`Meta ${res.status}: ${await res.text()}`);
  return res.json();
}

async function isRateLimited(phone) {
  const db = supa();
  const cutoff = new Date(Date.now() - RATE_LIMIT_MS).toISOString();
  const { count, error } = await db
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', cutoff);
  if (error) {
    console.error('rate limit check failed', error.message);
    return false;
  }
  return (count || 0) >= 1;
}

async function isActiveClient(phone) {
  const db = supa();
  const { data } = await db
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();
  return !!data;
}

async function isOptedOut(phone) {
  const db = supa();
  const { data: lead } = await db
    .from('leads').select('status').eq('phone', phone).maybeSingle();
  if (lead?.status === 'dropped') {
    const { count } = await db
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('phone', phone)
      .eq('direction', 'in')
      .ilike('body', '%stop%');
    if ((count || 0) > 0) return true;
  }
  return false;
}

export async function sendWhatsApp({
  to,
  templateName,
  params = [],
  body,
  bypassRateLimit = false,
  kind = 'session'
}) {
  const phone = normalizePhone(to);
  if (!phone) throw new Error('Missing recipient');

  if (await isOptedOut(phone)) {
    console.log(`skip: ${maskPhone(phone)} opted out`);
    return { skipped: 'opted_out' };
  }

  if (!bypassRateLimit && !(await isActiveClient(phone))) {
    if (await isRateLimited(phone)) {
      console.log(`skip: ${maskPhone(phone)} rate limited`);
      return { skipped: 'rate_limited' };
    }
  }

  let result;
  let status = 'sent';
  try {
    if (process.env.AISENSY_API_KEY) {
      result = await sendViaAiSensy({ to: phone, templateName, params, body });
    } else {
      result = await sendViaMeta({ to: phone, body: body || '(template)' });
    }
  } catch (e) {
    status = 'failed';
    console.error(`send failed to ${maskPhone(phone)}:`, e.message);
    await logMessage({ phone, direction: 'out', body, templateName, status });
    throw e;
  }

  await logMessage({ phone, direction: 'out', body, templateName, status });
  return { ok: true, kind, result };
}

export async function logMessage({ phone, direction, body, templateName = null, status = null }) {
  try {
    await supa().from('messages').insert({
      phone: normalizePhone(phone),
      direction,
      body: body ?? null,
      template_name: templateName,
      status
    });
  } catch (e) {
    console.error('logMessage failed', e?.message || e);
  }
}
