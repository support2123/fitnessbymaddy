// Unified WA sender. AiSensy primary, Meta Cloud API fallback.
// Enforces 2hr rate limit per lead (active clients exempt), logs every
// send to `messages`, masks phone in error logs.

import { db, maskPhone } from './supabase.js';

const AISENSY_BASE = process.env.AISENSY_BASE_URL || 'https://backend.aisensy.com';

function normPhone(p) {
  return String(p || '').replace(/[^\d+]/g, '');
}

// Returns the last outbound message to this phone within the last `hours` hours.
async function lastOutboundWithin(phone, hours) {
  const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
  const { data } = await db()
    .from('messages')
    .select('sent_at')
    .eq('phone', phone)
    .eq('direction', 'out')
    .gt('sent_at', since)
    .order('sent_at', { ascending: false })
    .limit(1);
  return data?.[0] || null;
}

async function isActiveClient(phone) {
  const { data } = await db()
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .eq('status', 'active')
    .limit(1);
  return !!data?.length;
}

async function isOptedOut(phone) {
  const { data } = await db()
    .from('leads')
    .select('status')
    .eq('phone', phone)
    .limit(1);
  return data?.[0]?.status === 'dropped';
}

async function logMsg(row) {
  await db().from('messages').insert(row);
}

async function sendAisensy({ phone, body, templateName, params }) {
  const res = await fetch(`${AISENSY_BASE}/campaign/t1/api/v2`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey: process.env.AISENSY_API_KEY,
      campaignName: (process.env.AISENSY_CAMPAIGN_PREFIX || 'fbm_') + (templateName || 'session'),
      destination: phone,
      userName: 'FitnessByMaddy',
      templateParams: params || [],
      source: 'fbm-automation',
      media: {},
      buttons: [],
      carouselCards: [],
      location: {},
      // session text fallback (only delivered within the 24h service window)
      message: body
    })
  });
  const txt = await res.text();
  return { ok: res.ok, status: res.status, body: txt };
}

async function sendMeta({ phone, body, templateName }) {
  const id = process.env.META_WA_PHONE_ID;
  const token = process.env.META_WA_TOKEN;
  if (!id || !token) throw new Error('Meta WA not configured');
  const payload = templateName
    ? { messaging_product: 'whatsapp', to: phone, type: 'template',
        template: { name: templateName, language: { code: 'en' } } }
    : { messaging_product: 'whatsapp', to: phone, type: 'text',
        text: { body, preview_url: true } };
  const res = await fetch(`https://graph.facebook.com/v20.0/${id}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });
  const txt = await res.text();
  return { ok: res.ok, status: res.status, body: txt };
}

// Core send. Returns { sent: bool, reason?: string, result?: any }.
// opts.force bypasses the rate limit (used for transactional onboarding).
export async function sendWhatsApp({ phone, body, templateName, params, force = false }) {
  phone = normPhone(phone);
  if (!phone) return { sent: false, reason: 'no_phone' };

  if (await isOptedOut(phone)) {
    return { sent: false, reason: 'opted_out' };
  }

  if (!force) {
    const active = await isActiveClient(phone);
    if (!active) {
      const last = await lastOutboundWithin(phone, 2);
      if (last) return { sent: false, reason: 'rate_limited' };
    }
  }

  let result;
  try {
    if (process.env.AISENSY_API_KEY) {
      result = await sendAisensy({ phone, body, templateName, params });
    } else {
      result = await sendMeta({ phone, body, templateName });
    }
  } catch (err) {
    console.error('WA send failed', maskPhone(phone), err.message);
    await logMsg({
      phone, direction: 'out', body, template_name: templateName,
      status: 'error', meta: { error: err.message }
    });
    return { sent: false, reason: 'gateway_error' };
  }

  await logMsg({
    phone, direction: 'out', body, template_name: templateName,
    status: result.ok ? 'sent' : 'failed',
    meta: { gateway_status: result.status, gateway_body: result.body?.slice(0, 500) }
  });

  return { sent: result.ok, result };
}

// Log an inbound WA message.
export async function logInbound({ phone, body, meta }) {
  phone = normPhone(phone);
  await logMsg({ phone, direction: 'in', body, status: 'received', meta });
}
