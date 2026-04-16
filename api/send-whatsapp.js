// Internal helper endpoint for sending WhatsApp messages.
// Used by other internal services that don't import the lib directly.
// Auth: x-cron-secret.
import { sendWhatsApp } from './_lib/whatsapp.js';
import { readJson, requireCronAuth } from './_lib/util.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false });
  if (!requireCronAuth(req)) return res.status(401).json({ ok: false });

  const body = await readJson(req);
  const { phone, body: text, templateName, bypassRateLimit } = body || {};
  if (!phone || !text) return res.status(400).json({ ok: false, error: 'phone + body required' });

  const result = await sendWhatsApp({
    phone, body: text, templateName: templateName || null,
    bypassRateLimit: !!bypassRateLimit,
    meta: { kind: 'manual' },
  });
  return res.status(result.ok ? 200 : 500).json(result);
}
