// AiSensy v2 outbound wrapper with Meta Cloud API fallback hook.
// Rate-limited via lib/rate-limit.js. All sends pass through logMessage().

import { db, logMessage } from './supabase.js';
import { canSend, recordSend } from './rate-limit.js';
import { maskPhone, normalizePhone } from './pii.js';

const AISENSY_URL = 'https://backend.aisensy.com/campaign/t1/api/v2';

export async function sendWhatsApp({
  phone,
  body,
  templateName,
  campaignName,
  params = [],
  mediaUrl,
  force = false
}) {
  const to = normalizePhone(phone);
  if (!to) return { ok: false, reason: 'bad_phone' };

  if (!force) {
    const { allowed, reason } = await canSend(to);
    if (!allowed) {
      console.log(`[wa] skipped ${maskPhone(to)} — ${reason}`);
      return { ok: false, reason };
    }
  }

  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) {
    console.error('[wa] AISENSY_API_KEY missing');
    return { ok: false, reason: 'no_api_key' };
  }

  const payload = {
    apiKey,
    campaignName: campaignName || templateName || 'transactional',
    destination: to,
    userName: 'FitnessByMaddy',
    templateParams: params,
    source: 'pipeline',
    media: mediaUrl ? { url: mediaUrl, filename: 'attachment' } : undefined,
    buttons: [],
    paramsFallbackValue: {}
  };

  let ok = false;
  let status = 'unknown';
  try {
    const res = await fetch(AISENSY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    ok = res.ok;
    status = `aisensy_${res.status}`;
  } catch (err) {
    console.error('[wa] send failed', err?.message);
    status = 'network_error';
  }

  if (ok) await recordSend(to);

  await logMessage({
    phone: to,
    direction: 'out',
    body: body || null,
    template_name: templateName || null,
    status,
    meta: { campaignName, params }
  });

  return { ok, status };
}

export async function notifyMaddy(text) {
  const maddy = process.env.MADDY_PHONE;
  if (!maddy) return { ok: false, reason: 'no_maddy_phone' };
  return sendWhatsApp({
    phone: maddy,
    body: text,
    templateName: 'ops_alert',
    campaignName: 'ops_alert',
    params: [text.slice(0, 900)],
    force: true
  });
}
