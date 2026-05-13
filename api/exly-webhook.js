const crypto = require('crypto');
const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { detectMarket, isHinglish } = require('./_lib/market');

const PROGRAM_MAP = {
  '6wk-shred': '6wk_gym',
  '6wk-home': '6wk_home',
  '12wk-custom': '12wk',
  'pcos-warrior': 'pcos',
  '40plus-strong': '40plus',
  'zoom-trial': 'zoom_trial',
  'zoom-pack': 'zoom_pack'
};

const PROGRAM_DURATIONS = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  pcos: 42,
  '40plus': 42,
  zoom_trial: 7,
  zoom_pack: 28
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (process.env.EXLY_WEBHOOK_SECRET) {
    const signature = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'];
    if (signature) {
      const expected = crypto
        .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (signature !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }
  }

  const db = getSupabase();
  const data = req.body;

  const phone = normalizePhone(data.phone || data.customer_phone || data.mobile);
  const email = data.email || data.customer_email;
  const name = data.name || data.customer_name;
  const checkoutId = data.checkout_id || data.order_id || data.transaction_id;
  const productSlug = data.product_slug || data.product_id || '';
  const amount = data.amount || data.paid_amount;

  if (!phone) {
    return res.status(400).json({ error: 'Phone number required' });
  }

  const program = PROGRAM_MAP[productSlug] || guessProgram(amount);
  const durationDays = PROGRAM_DURATIONS[program] || 42;
  const now = new Date();
  const endDate = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

  const { data: lead } = await db
    .from('leads')
    .select('id')
    .eq('phone', phone)
    .single();

  if (lead) {
    await db.from('leads')
      .update({ status: 'converted' })
      .eq('id', lead.id);
  }

  const { data: client, error: clientErr } = await db.from('clients').insert({
    lead_id: lead?.id || null,
    phone,
    name,
    email,
    program,
    program_started_at: now.toISOString(),
    program_ends_at: endDate.toISOString(),
    paid_amount: amount ? parseInt(amount) : null,
    checkout_id: checkoutId,
    folder_url: `/clients/${checkoutId || Date.now()}/`,
    status: 'active'
  }).select().single();

  if (clientErr) {
    console.error('Client insert error:', clientErr.message);
    return res.status(500).json({ error: 'Failed to create client' });
  }

  const market = detectMarket(phone);
  const templateName = isHinglish(market)
    ? `onboard_${program}_hi`
    : `onboard_${program}_en`;

  await sendWhatsApp({
    phone,
    templateName,
    params: [name || 'there']
  });

  if (program === '12wk') {
    try {
      const baseUrl = `https://${req.headers.host}`;
      await fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`
        },
        body: JSON.stringify({
          client_id: client.id,
          week_no: 1
        })
      });
    } catch (err) {
      console.error('Week-1 program generation failed:', err.message);
    }
  }

  return res.status(200).json({ ok: true, client_id: client.id });
};

function normalizePhone(phone) {
  if (!phone) return null;
  const cleaned = phone.replace(/[^0-9+]/g, '');
  return cleaned.startsWith('+') ? cleaned : '+' + cleaned;
}

function guessProgram(amount) {
  if (!amount) return '6wk_gym';
  const a = parseInt(amount);
  if (a <= 25) return 'zoom_trial';
  if (a <= 50) return 'pcos';
  if (a <= 100) return '6wk_gym';
  return '12wk';
}
