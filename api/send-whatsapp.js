import { sendWhatsApp } from './_lib/whatsapp.js';
import { json, readBody, requireMethod, requireAuth } from './_lib/http.js';

// Internal helper endpoint (token-protected). Useful for admin UI / manual sends.
export default async function handler(req, res) {
  if (!requireMethod(req, res, 'POST')) return;
  if (!requireAuth(req, res, 'ADMIN_TOKEN')) return;

  try {
    const { to, templateName, params, body, bypassRateLimit } = await readBody(req);
    if (!to || (!templateName && !body)) {
      return json(res, 400, { error: 'to + (templateName or body) required' });
    }
    const result = await sendWhatsApp({ to, templateName, params, body, bypassRateLimit: !!bypassRateLimit });
    return json(res, 200, result);
  } catch (e) {
    return json(res, 500, { error: e.message });
  }
}
