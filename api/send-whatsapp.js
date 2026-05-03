import { sendTemplate, sendText, canSendMessage } from './_lib/whatsapp.js';
import { maskPhone, jsonResponse, parseBody } from './_lib/helpers.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return jsonResponse(res, 405, { error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (!authHeader || authHeader !== `Bearer ${process.env.SUPABASE_SERVICE_KEY}`) {
    return jsonResponse(res, 401, { error: 'Unauthorized' });
  }

  try {
    const body = await parseBody(req);
    const { phone, template, params, text, force } = body;

    if (!phone) return jsonResponse(res, 400, { error: 'Missing phone' });

    if (!force) {
      const allowed = await canSendMessage(phone);
      if (!allowed) {
        return jsonResponse(res, 429, {
          error: 'Rate limited — max 1 message per 2 hours for non-clients',
        });
      }
    }

    let result;
    if (template) {
      result = await sendTemplate(phone, template, params || []);
    } else if (text) {
      result = await sendText(phone, text);
    } else {
      return jsonResponse(res, 400, { error: 'Provide template or text' });
    }

    console.log(`Sent to ${maskPhone(phone)}: ${template || 'text'}`);
    return jsonResponse(res, 200, { success: true, result });
  } catch (err) {
    console.error('Send error:', err.message);
    return jsonResponse(res, 500, { error: 'Internal server error' });
  }
}
