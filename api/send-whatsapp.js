// Internal helper endpoint: rate-limited WhatsApp sender.
// Use from Maddy's tools, internal scripts, or manual triggers.
// Requires ADMIN_TOKEN (Bearer or ?token=).

import { json, readBody, requireAdmin } from '../lib/http.js';
import { sendWhatsApp } from '../lib/whatsapp.js';

export default async function handler(req, res) {
  if (!requireAdmin(req)) return json(res, 401, { error: 'unauthorized' });
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });

  const { phone, body, templateName, campaignName, params, mediaUrl, force } = await readBody(req);
  if (!phone) return json(res, 400, { error: 'missing_phone' });

  const result = await sendWhatsApp({
    phone,
    body,
    templateName,
    campaignName,
    params: Array.isArray(params) ? params : [],
    mediaUrl,
    force: !!force
  });

  return json(res, result.ok ? 200 : 409, result);
}
