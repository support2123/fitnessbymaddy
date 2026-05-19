import { createClient } from '../lib/supabase.js';
import { sendTemplate, sendText } from '../lib/whatsapp.js';
import { parseBody, cors, maskPhone } from '../lib/helpers.js';

/* ── Rate-limit window (ms) ──────────────────────────────────────── */
const RATE_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 hours

/* ── Handler ─────────────────────────────────────────────────────── */

export default async function handler(req, res) {
  if (cors(res)) return; // handle OPTIONS preflight

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  /* ── Auth check ────────────────────────────────────────────────── */
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) {
    console.error('send-whatsapp: INTERNAL_API_SECRET not configured');
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : authHeader;

  if (token !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  /* ── Parse body ────────────────────────────────────────────────── */
  let body;
  try {
    body = await parseBody(req);
  } catch (err) {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  const { phone, template, params, text, force } = body;

  if (!phone) {
    return res.status(400).json({ error: 'Missing phone' });
  }

  if (!template && !text) {
    return res.status(400).json({ error: 'Provide template or text' });
  }

  try {
    /* ── Rate limit (unless force) ───────────────────────────────── */
    if (!force) {
      const supabase = createClient();
      const cutoff = new Date(Date.now() - RATE_LIMIT_MS).toISOString();

      const { data: recent } = await supabase
        .from('messages')
        .select('id')
        .eq('phone', phone)
        .eq('direction', 'out')
        .gte('sent_at', cutoff)
        .limit(1);

      if (recent && recent.length > 0) {
        console.log(`send-whatsapp: rate limited for ${maskPhone(phone)}`);
        return res.status(200).json({
          success: false,
          reason: 'rate_limited',
        });
      }
    }

    /* ── Send message ────────────────────────────────────────────── */
    let result = null;

    if (template) {
      result = await sendTemplate(phone, template, params || []);
    } else if (text) {
      result = await sendText(phone, text);
    }

    if (!result) {
      return res.status(200).json({
        success: false,
        reason: 'send_failed_or_rate_limited_internally',
      });
    }

    const messageId = result?.data?.id || result?.id || null;

    return res.status(200).json({
      success: true,
      message_id: messageId,
    });
  } catch (err) {
    console.error('send-whatsapp: unexpected error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
