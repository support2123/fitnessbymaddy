const { supabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { logMessage } = require('../lib/rate-limit');
const { detectMarket, isHinglish } = require('../lib/market');
const crypto = require('crypto');

const PROGRAM_MAP = {
  '6_week_shred': '6wk_gym',
  '6_week_home': '6wk_home',
  '12_week_custom': '12wk',
  'pcos_warrior': 'pcos',
  '40_plus_strong': '40plus',
  'zoom_trial': 'zoom_trial',
  'zoom_pack': 'zoom_pack',
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (process.env.EXLY_WEBHOOK_SECRET) {
    const sig = req.headers['x-exly-signature'];
    const expected = crypto
      .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
      .update(JSON.stringify(req.body))
      .digest('hex');
    if (sig !== expected) {
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }

  const {
    customer_phone, customer_name, customer_email,
    product_id, product_name, amount, checkout_id,
  } = req.body;

  if (!customer_phone) {
    return res.status(400).json({ error: 'customer_phone required' });
  }

  const program = PROGRAM_MAP[product_id] || product_id || 'unknown';
  const phone = customer_phone.startsWith('+') ? customer_phone : `+${customer_phone}`;

  const { data: lead } = await supabase
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .single();

  const leadId = lead?.id || null;

  if (lead) {
    await supabase
      .from('leads')
      .update({ status: 'converted', last_msg_at: new Date().toISOString() })
      .eq('id', lead.id);
  }

  const programDurationWeeks = program === '12wk' ? 12 : 6;
  const startDate = new Date();
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + programDurationWeeks * 7);

  const { data: client } = await supabase
    .from('clients')
    .insert({
      lead_id: leadId,
      phone,
      name: customer_name || lead?.name || null,
      email: customer_email || null,
      program,
      program_started_at: startDate.toISOString(),
      program_ends_at: endDate.toISOString(),
      paid_amount: parseFloat(amount) || 0,
      checkout_id: checkout_id || null,
      status: 'active',
    })
    .select()
    .single();

  const folderPath = `clients/${client.id}`;
  await supabase.storage
    .from('client-files')
    .upload(`${folderPath}/.keep`, new Uint8Array(0), { upsert: true });

  const market = lead?.market || detectMarket(phone);
  const hinglish = isHinglish(market);
  const templateName = hinglish ? `onboard_${program}_hi` : `onboard_${program}_en`;

  await sendTemplate(phone, templateName, [customer_name || 'there']);
  await logMessage(phone, 'out', `[template:${templateName}] onboarding`, templateName);

  if (program === '12wk') {
    try {
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'https://fitnessbymaddy.com';
      await fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-key': process.env.INTERNAL_API_KEY,
        },
        body: JSON.stringify({ client_id: client.id, week_no: 1 }),
      });
    } catch (_) {}
  }

  return res.status(200).json({ ok: true, client_id: client.id });
};
