const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { parseBody, json } = require('../lib/utils');

const RATE_LIMIT_MS = 2 * 60 * 60 * 1000;

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return json(res, 200, { ok: true });
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  const { phone, template, params, mediaUrl, skipRateLimit } = await parseBody(req);

  if (!phone || !template) {
    return json(res, 400, { error: 'phone and template required' });
  }

  const internalKey = req.headers['x-internal-key'];
  if (internalKey !== process.env.SUPABASE_SERVICE_KEY) {
    return json(res, 401, { error: 'Unauthorized' });
  }

  if (!skipRateLimit) {
    const db = getSupabase();
    const cutoff = new Date(Date.now() - RATE_LIMIT_MS).toISOString();
    const { data: recent } = await db
      .from('messages')
      .select('id')
      .eq('phone', phone)
      .eq('direction', 'out')
      .gte('sent_at', cutoff)
      .limit(1);

    if (recent && recent.length > 0) {
      const { data: client } = await db
        .from('clients')
        .select('id')
        .eq('phone', phone)
        .eq('status', 'active')
        .single();

      if (!client) {
        return json(res, 429, { error: 'Rate limited — 1 message per 2 hours for non-clients' });
      }
    }
  }

  const result = await sendWhatsApp(phone, template, params || [], mediaUrl || null);
  return json(res, 200, { sent: true, result });
};
