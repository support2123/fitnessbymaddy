const { supabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/market');
const crypto = require('crypto');

const PROGRAM_MAP = {
  '6wk-burn-build': '6wk_gym',
  '6wk-home': '6wk_home',
  'pcos-warrior': 'pcos',
  '40plus-strong': '40plus',
  '12wk-flagship': '12wk',
  'zoom-trial': 'zoom_trial',
  'zoom-pack': 'zoom_pack',
};

const PROGRAM_DURATIONS = {
  '6wk_gym': 42, '6wk_home': 42,
  pcos: 42, '40plus': 42,
  '12wk': 84,
  zoom_trial: 7, zoom_pack: 28,
};

function verifyWebhook(req) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true;
  const sig = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'];
  if (!sig) return false;
  const expected = crypto.createHmac('sha256', secret).update(JSON.stringify(req.body)).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    if (!verifyWebhook(req)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const {
      phone, name, email, checkout_id, product_slug,
      amount, currency,
    } = req.body;

    if (!phone || !product_slug) {
      return res.status(400).json({ error: 'phone and product_slug required' });
    }

    const program = PROGRAM_MAP[product_slug] || product_slug;
    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const endsAt = new Date(Date.now() + durationDays * 86400000).toISOString();

    const { data: lead } = await supabase
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .limit(1)
      .single();

    if (lead) {
      await supabase
        .from('leads')
        .update({ status: 'converted', program_interest: program })
        .eq('id', lead.id);
    }

    const folderPath = `clients/${crypto.randomUUID()}`;

    const { data: client, error } = await supabase
      .from('clients')
      .insert({
        lead_id: lead?.id || null,
        phone,
        name: name || null,
        email: email || null,
        program,
        program_started_at: new Date().toISOString(),
        program_ends_at: endsAt,
        paid_amount: amount || null,
        checkout_id: checkout_id || null,
        folder_url: folderPath,
        status: 'active',
      })
      .select()
      .single();

    if (error) {
      console.error('Client insert error:', error.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    await sendTemplate(phone, `onboard_${program}`, {
      name: name || 'there',
      templateParams: [name || 'there', `Week 1 starts now!`],
    }, true);

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: `Purchase confirmed: ${program} ($${amount || 'N/A'}) checkout: ${checkout_id}`,
      status: 'received',
    });

    if (program === '12wk') {
      try {
        const baseUrl = `https://${req.headers.host}`;
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch (genErr) {
        console.error('Week 1 program gen failed:', genErr.message);
      }
    }

    return res.status(200).json({ success: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
