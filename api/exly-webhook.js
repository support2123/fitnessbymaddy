const { supabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');
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

const PROGRAM_DURATION = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 28
};

function verifyWebhook(req) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true;
  const signature = req.headers['x-exly-signature'] || '';
  const expected = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(req.body))
    .digest('hex');
  return signature === expected;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!verifyWebhook(req)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  try {
    const { customer_phone, customer_name, customer_email, product_name, amount, order_id } = req.body;

    if (!customer_phone) return res.status(400).json({ error: 'Missing phone' });

    const program = PROGRAM_MAP[product_name] || '6wk_gym';
    const durationDays = PROGRAM_DURATION[program] || 42;
    const endsAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString();

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', customer_phone)
      .single();

    if (lead) {
      await supabase
        .from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id')
      .eq('phone', customer_phone)
      .eq('program', program)
      .single();

    let clientId;
    if (existingClient) {
      await supabase
        .from('clients')
        .update({
          status: 'active',
          paid_amount: amount,
          checkout_id: order_id,
          program_started_at: new Date().toISOString(),
          program_ends_at: endsAt
        })
        .eq('id', existingClient.id);
      clientId = existingClient.id;
    } else {
      const { data: newClient } = await supabase
        .from('clients')
        .insert({
          lead_id: lead?.id || null,
          phone: customer_phone,
          name: customer_name,
          email: customer_email,
          program,
          paid_amount: amount,
          checkout_id: order_id,
          status: 'active',
          program_started_at: new Date().toISOString(),
          program_ends_at: endsAt,
          folder_url: `/clients/${crypto.randomUUID()}/`
        })
        .select()
        .single();
      clientId = newClient.id;
    }

    await sendWhatsApp(customer_phone, `onboard_${program}`, {
      name: customer_name || 'there',
      templateParams: [customer_name || 'there', program]
    }, true);

    if (program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://fitnessbymaddy.com';
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: clientId, week_no: 1 })
        });
      } catch (e) {
        console.error('Program generation trigger failed:', e.message);
      }
    }

    return res.status(200).json({ success: true, client_id: clientId });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
