// Internal helper endpoint. Other endpoints and crons call this directly
// via the library; expose here too for ad-hoc sends from the admin UI.

import { sendTemplate, sendText } from '../lib/aisensy.js';
import { canSend } from '../lib/rate-limit.js';
import { normalisePhone, jsonResponse, readBody } from '../lib/utils.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return jsonResponse(res, 405, { error: 'POST only' });

  const secret = req.headers['x-internal-secret'];
  if (secret !== process.env.SUPABASE_SERVICE_KEY) {
    return jsonResponse(res, 401, { error: 'unauthorised' });
  }

  const body = await readBody(req);
  const phone = normalisePhone(body.phone);
  if (!phone) return jsonResponse(res, 400, { error: 'phone required' });

  const ok = await canSend({ phone, force: !!body.force });
  if (!ok) return jsonResponse(res, 429, { error: 'rate_limited' });

  const status = body.template
    ? await sendTemplate({ phone, template: body.template, params: body.params || [], body: body.body })
    : await sendText({ phone, body: body.body });

  return jsonResponse(res, 200, { status });
}
