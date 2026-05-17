const crypto = require('crypto');
const { getSupabase } = require('./lib/supabase');
const { sendTemplate, maskPhone } = require('./lib/whatsapp');
const { logMessage } = require('./lib/rate-limit');

const PROGRAM_MAP = {
  '6wk-burn-build': '6wk_gym',
  '6wk-home': '6wk_home',
  '12wk-flagship': '12wk',
  'pcos-warrior': 'pcos',
  '40plus-strong': '40plus',
  'zoom-trial': 'zoom_trial',
  'zoom-pack': 'zoom_pack',
};

const PROGRAM_DURATIONS = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 28,
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    if (!verifyWebhookSignature(req)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const { phone, email, name, product_id, amount, checkout_id } = parseExlyPayload(req.body);
    if (!phone || !product_id) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const supabase = getSupabase();
    const program = PROGRAM_MAP[product_id] || '6wk_gym';
    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const programEnds = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString();

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (lead) {
      await supabase.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const { data: client, error } = await supabase.from('clients').insert({
      lead_id: lead?.id || null,
      phone,
      name: name || lead?.name || null,
      email: email || null,
      program,
      program_started_at: new Date().toISOString(),
      program_ends_at: programEnds,
      paid_amount: amount || null,
      checkout_id: checkout_id || null,
      status: 'active',
    }).select().single();

    if (error) throw error;

    const folderPath = `clients/${client.id}/`;
    await supabase.storage
      .from('programs')
      .upload(`${folderPath}.keep`, new Uint8Array(0), { upsert: true });

    await supabase.from('clients')
      .update({ folder_url: folderPath })
      .eq('id', client.id);

    const templateName = `onboard_${program}`;
    await sendTemplate(phone, templateName, [name || 'there']);
    await logMessage(phone, 'out', null, templateName);

    if (program === '12wk') {
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'https://fitnessbymaddy.com';
      await fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: client.id, week_no: 1 }),
      }).catch(() => {});
    }

    return res.status(200).json({ success: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function verifyWebhookSignature(req) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true;
  const signature = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'];
  if (!signature) return false;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(req.body))
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

function parseExlyPayload(body) {
  if (!body) return {};
  return {
    phone: body.phone || body.customer_phone || body.buyer?.phone,
    email: body.email || body.customer_email || body.buyer?.email,
    name: body.name || body.customer_name || body.buyer?.name,
    product_id: body.product_id || body.productId || body.item?.id,
    amount: body.amount || body.total_amount || body.payment?.amount,
    checkout_id: body.checkout_id || body.order_id || body.id,
  };
}
