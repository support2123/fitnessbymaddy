const { supabase } = require('../lib/supabase');
const { sendWhatsApp, detectMarket } = require('../lib/whatsapp');
const crypto = require('crypto');

const PROGRAM_MAP = {
  '6_week_shred': '6wk_gym',
  '6_week_home': '6wk_home',
  '12_week_custom': '12wk',
  'pcos_warrior': 'pcos',
  '40_plus': '40plus',
  'zoom_trial': 'zoom_trial',
  'zoom_pack': 'zoom_pack'
};

const PROGRAM_DURATIONS = {
  '6wk_gym': 42, '6wk_home': 42, '12wk': 84,
  'pcos': 42, '40plus': 42, 'zoom_trial': 7, 'zoom_pack': 30
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    if (process.env.EXLY_WEBHOOK_SECRET) {
      const sig = req.headers['x-exly-signature'];
      const expected = crypto
        .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (sig && sig !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const { phone, name, email, amount, product_id, checkout_id } = parseExlyPayload(req.body);
    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    const program = PROGRAM_MAP[product_id] || '6wk_gym';
    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const programEnds = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString();

    let leadId = null;
    const { data: lead } = await supabase
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .single();

    if (lead) {
      leadId = lead.id;
      await supabase.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const { data: client } = await supabase.from('clients').insert({
      lead_id: leadId,
      phone,
      name: name || null,
      email: email || null,
      program,
      program_ends_at: programEnds,
      paid_amount: parseInt(amount) || 0,
      checkout_id: checkout_id || null,
      folder_url: `/clients/${checkout_id || 'unknown'}/`,
      status: 'active'
    }).select().single();

    const market = detectMarket(phone);
    const template = market === 'IN' ? `onboard_${program}_hi` : `onboard_${program}_en`;
    await sendWhatsApp(phone, template, [name || 'there']);

    if (program === '12wk') {
      const origin = req.headers['x-forwarded-proto'] === 'https'
        ? `https://${req.headers['x-forwarded-host'] || req.headers['host']}`
        : `http://${req.headers['host']}`;

      fetch(`${origin}/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`
        },
        body: JSON.stringify({ client_id: client.id, week_no: 1 })
      }).catch(() => {});
    }

    return res.json({ ok: true, client_id: client.id });

  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function parseExlyPayload(body) {
  if (!body) return {};
  return {
    phone: body.phone || body.customer_phone || body.data?.phone,
    name: body.name || body.customer_name || body.data?.name,
    email: body.email || body.customer_email || body.data?.email,
    amount: body.amount || body.total || body.data?.amount,
    product_id: body.product_id || body.product || body.data?.product_id,
    checkout_id: body.checkout_id || body.order_id || body.data?.checkout_id
  };
}
