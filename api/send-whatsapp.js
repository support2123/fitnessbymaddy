import { sendTemplate, sendText } from '../lib/whatsapp.js';
import { jsonResponse } from '../lib/utils.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return jsonResponse(res, 405, { error: 'Method not allowed' });

  const auth = req.headers.authorization;
  if (auth !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return jsonResponse(res, 401, { error: 'Unauthorized' });
  }

  try {
    const { phone, template, params, text } = req.body;

    if (!phone) return jsonResponse(res, 400, { error: 'phone required' });

    let result;
    if (template) {
      result = await sendTemplate(phone, template, params || []);
    } else if (text) {
      result = await sendText(phone, text);
    } else {
      return jsonResponse(res, 400, { error: 'template or text required' });
    }

    return jsonResponse(res, result.ok ? 200 : 429, result);
  } catch (err) {
    console.error('Send WA error:', err.message);
    return jsonResponse(res, 500, { error: 'Internal error' });
  }
}
