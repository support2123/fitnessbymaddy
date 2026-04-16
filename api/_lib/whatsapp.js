// Unified WhatsApp sender with rate-limit + audit-log.
// Provider: AiSensy (default) -> Meta Cloud API (fallback).
import { db } from './supabase.js';
import { maskPhone, normalisePhone, addHoursIso } from './util.js';

const RATE_WINDOW_HOURS = 2;

export async function sendWhatsApp({
  phone,
  body,
  templateName = null,
  bypassRateLimit = false,
  meta = {},
}) {
  const to = normalisePhone(phone);
  if (!to) return { ok: false, error: 'invalid phone' };

  if (!bypassRateLimit) {
    const blocked = await isRateLimited(to);
    if (blocked) {
      return { ok: false, error: 'rate-limited', skipped: true };
    }
  }

  const provider = (process.env.WHATSAPP_PROVIDER || 'aisensy').toLowerCase();
  let result;
  try {
    result = provider === 'meta'
      ? await sendViaMeta({ to, body, templateName })
      : await sendViaAiSensy({ to, body, templateName });
  } catch (err) {
    result = { ok: false, error: err.message };
  }

  // Try fallback once if primary failed.
  if (!result.ok) {
    try {
      result = provider === 'meta'
        ? await sendViaAiSensy({ to, body, templateName })
        : await sendViaMeta({ to, body, templateName });
    } catch (err) {
      result = { ok: false, error: err.message };
    }
  }

  await logMessage({
    phone: to,
    direction: 'out',
    body,
    templateName,
    status: result.ok ? 'sent' : 'failed',
    meta: { ...meta, provider_result: result },
  });

  return result;
}

async function sendViaAiSensy({ to, body, templateName }) {
  const key = process.env.AISENSY_API_KEY;
  const base = process.env.AISENSY_API_BASE || 'https://backend.aisensy.com';
  if (!key) throw new Error('AISENSY_API_KEY not set');

  const payload = {
    apiKey: key,
    campaignName: templateName || 'session_message',
    destination: to.replace(/^\+/, ''),
    userName: 'Maddy',
    templateParams: [],
    source: 'fitnessbymaddy-pipeline',
    media: {},
    buttons: [],
    carouselCards: [],
    location: {},
    paramsFallbackValue: { FirstName: 'there' },
    message: body,
  };

  const r = await fetch(`${base}/campaign/t1/api/v2`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const text = await r.text();
  return { ok: r.ok, provider: 'aisensy', status: r.status, body: text };
}

async function sendViaMeta({ to, body, templateName }) {
  const token = process.env.META_WA_TOKEN;
  const phoneId = process.env.META_WA_PHONE_ID;
  if (!token || !phoneId) throw new Error('Meta WA not configured');

  const payload = templateName
    ? {
        messaging_product: 'whatsapp',
        to: to.replace(/^\+/, ''),
        type: 'template',
        template: { name: templateName, language: { code: 'en' } },
      }
    : {
        messaging_product: 'whatsapp',
        to: to.replace(/^\+/, ''),
        type: 'text',
        text: { body },
      };

  const r = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  const text = await r.text();
  return { ok: r.ok, provider: 'meta', status: r.status, body: text };
}

async function isRateLimited(phone) {
  // Don't send more than 1 outbound per phone per RATE_WINDOW_HOURS,
  // unless this is an active client (then no per-message limit).
  const supa = db();
  const { data: client } = await supa
    .from('clients')
    .select('id,status')
    .eq('phone', phone)
    .eq('status', 'active')
    .maybeSingle();
  if (client) return false;

  const since = new Date(Date.now() - RATE_WINDOW_HOURS * 3600_000).toISOString();
  const { count } = await supa
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('phone', phone)
    .eq('direction', 'out')
    .gte('sent_at', since);
  return (count || 0) >= 1;
}

export async function logMessage({
  phone, direction, body, templateName = null, status = null, meta = {},
}) {
  try {
    await db().from('messages').insert({
      phone, direction, body, template_name: templateName, status, meta,
    });
  } catch (err) {
    console.error('msg log failed', maskPhone(phone), err.message);
  }
}

export { addHoursIso };
