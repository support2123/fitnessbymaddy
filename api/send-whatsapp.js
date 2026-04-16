// Internal helper endpoint. Used by Maddy's own tooling / the admin dashboard.
// Gated to internal callers — never expose to the public.

import { sendWhatsApp } from '../lib/whatsapp.js';
import { readJson, json, methodNotAllowed } from '../lib/http.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, 'POST');

  const internal = req.headers['x-internal'] === (process.env.CRON_SECRET || '');
  if (!internal) return json(res, 401, { ok: false, error: 'internal_only' });

  const { phone, body, template, params, force } = await readJson(req);
  if (!phone || !body) return json(res, 400, { ok: false, error: 'missing_phone_or_body' });

  const r = await sendWhatsApp({
    phone, body, templateName: template, params, force: !!force
  });
  return json(res, r.sent ? 200 : 202, r);
}
