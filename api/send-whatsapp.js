import { sendTemplate, sendText, canSendMessage } from '../lib/whatsapp.js';
import { jsonResponse, corsHeaders } from '../lib/helpers.js';

export default async function handler(req, res) {
  if (corsHeaders(req, res)) return;
  if (req.method !== 'POST') return jsonResponse(res, { error: 'POST only' }, 405);

  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_KEY || process.env.SUPABASE_SERVICE_KEY}`) {
    return jsonResponse(res, { error: 'Unauthorized' }, 401);
  }

  const { phone, type, templateName, params, message } = req.body;
  if (!phone) return jsonResponse(res, { error: 'Missing phone' }, 400);

  try {
    const canSend = await canSendMessage(phone);
    if (!canSend && type !== 'force') {
      return jsonResponse(res, { error: 'Rate limited — max 1 msg per 2hrs for non-clients', rateLimited: true }, 429);
    }

    let result;
    if (type === 'template' && templateName) {
      result = await sendTemplate(phone, templateName, params || []);
    } else if (message) {
      result = await sendText(phone, message);
    } else {
      return jsonResponse(res, { error: 'Provide templateName or message' }, 400);
    }

    return jsonResponse(res, { ok: true, result });
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return jsonResponse(res, { error: 'Failed to send' }, 500);
  }
}
