const { getClient } = require('./lib/supabase');
const { sendTemplate, notifyMaddy } = require('./lib/whatsapp');
const { cors, parseBody, normalizePhone, maskPhone, PROGRAM_NAMES } = require('./lib/helpers');
const crypto = require('crypto');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = await parseBody(req);

    const secret = process.env.EXLY_WEBHOOK_SECRET;
    if (secret && req.headers['x-exly-signature']) {
      const sig = crypto
        .createHmac('sha256', secret)
        .update(JSON.stringify(body))
        .digest('hex');
      if (sig !== req.headers['x-exly-signature']) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const phone = normalizePhone(body.phone || body.customer_phone || '');
    const email = body.email || body.customer_email || '';
    const name = body.name || body.customer_name || '';
    const program = body.program || body.product_name || '';
    const amount = body.amount || body.paid_amount || 0;
    const checkoutId = body.checkout_id || body.order_id || '';

    if (!phone) {
      return res.status(400).json({ error: 'Phone required' });
    }

    const db = getClient();

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .limit(1)
      .single();

    const programKey = mapExlyProgram(program);

    const programWeeks = {
      '6wk_gym': 6, '6wk_home': 6, '12wk': 12,
      'pcos': 6, '40plus': 8, 'zoom_trial': 1, 'zoom_pack': 8
    };
    const weeks = programWeeks[programKey] || 12;
    const endsAt = new Date();
    endsAt.setDate(endsAt.getDate() + weeks * 7);

    const { data: client, error } = await db.from('clients').insert({
      lead_id: lead ? lead.id : null,
      phone,
      name: name || (lead ? lead.name : null),
      email,
      program: programKey,
      program_started_at: new Date().toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: parseInt(amount, 10),
      checkout_id: checkoutId,
      folder_url: null,
      status: 'active'
    }).select().single();

    if (error) {
      console.error('[Exly] Client insert error:', error.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    if (lead) {
      await db.from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const folderPath = `clients/${client.id}`;
    await db.storage.from('clients').upload(`${client.id}/.keep`, new Uint8Array(0), {
      contentType: 'text/plain',
      upsert: true
    });
    await db.from('clients')
      .update({ folder_url: folderPath })
      .eq('id', client.id);

    await sendTemplate(phone, `onboard_${programKey}`, [name || 'there']);

    console.log(`[Exly] Conversion: ${maskPhone(phone)} → ${PROGRAM_NAMES[programKey] || programKey}`);
    return res.status(200).json({ ok: true, client_id: client.id });
  } catch (err) {
    console.error('[Exly] Error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function mapExlyProgram(exlyName) {
  if (!exlyName) return '12wk';
  const lower = exlyName.toLowerCase();
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40') || lower.includes('plus')) return '40plus';
  if (lower.includes('zoom') && lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('zoom')) return 'zoom_pack';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('6') || lower.includes('shred') || lower.includes('burn')) return '6wk_gym';
  if (lower.includes('12') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  return '12wk';
}
