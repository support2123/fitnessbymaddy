const { getSupabase } = require('./_lib/supabase');
const { sendTextMessage, sendTemplate } = require('./_lib/whatsapp');
const { maskPhone, errorResponse, jsonResponse } = require('./_lib/utils');

const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return errorResponse(res, 'POST only', 405);

  const { phone, body, templateName, params, bypassRateLimit } = req.body;

  if (!phone) return errorResponse(res, 'Missing phone');
  if (!body && !templateName) return errorResponse(res, 'Missing body or templateName');

  const db = getSupabase();

  try {
    if (!bypassRateLimit) {
      const { data: isClient } = await db
        .from('clients').select('id').eq('phone', phone).eq('status', 'active').single();

      if (!isClient) {
        const cutoff = new Date(Date.now() - RATE_LIMIT_MS).toISOString();
        const { data: recentMsg } = await db
          .from('messages')
          .select('id')
          .eq('phone', phone)
          .eq('direction', 'out')
          .gte('sent_at', cutoff)
          .limit(1)
          .single();

        if (recentMsg) {
          return jsonResponse(res, {
            sent: false, reason: 'rate_limited',
            message: `Max 1 msg per 2hrs for non-clients. Phone: ${maskPhone(phone)}`
          });
        }
      }
    }

    let result;
    if (templateName) {
      result = await sendTemplate(phone, templateName, params || []);
    } else {
      result = await sendTextMessage(phone, body);
    }

    return jsonResponse(res, { sent: true, result });
  } catch (err) {
    console.error('Send WA error:', err.message);
    return errorResponse(res, 'Failed to send', 500);
  }
};
