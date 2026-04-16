// Internal helper endpoint for sending WhatsApp from server-side jobs
// or the admin dashboard. Must be called with the CRON_SECRET / admin JWT —
// this is never exposed to the public form pages.

import { sendTemplate, sendText } from './_lib/whatsapp.js';
import { normalizePhone, json, assertCron } from './_lib/utils.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
  if (!assertCron(req))       return json(res, 401, { error: 'unauthorized' });

  const { phone, templateName, params, body, force } = req.body || {};
  const p = normalizePhone(phone);
  if (!p) return json(res, 400, { error: 'invalid_phone' });

  const result = templateName
    ? await sendTemplate({ phone: p, templateName, params, force: !!force, isClient: true })
    : await sendText({ phone: p, body, force: !!force, isClient: true });

  return json(res, result.ok ? 200 : 502, result);
}
