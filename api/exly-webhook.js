const crypto = require('crypto');
const { getClient } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');

function verifySignature(body, signature, secret) {
  if (!secret) return true;
  const hash = crypto.createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex');
  return hash === signature;
}

const PROGRAM_DURATIONS = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 30,
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabase = getClient();

  try {
    const signature = req.headers['x-exly-signature'];
    if (!verifySignature(req.body, signature, process.env.EXLY_WEBHOOK_SECRET)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const { phone, name, email, product_id, amount, checkout_id } = req.body;

    if (!phone || !product_id) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const program = product_id;
    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const endsAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString();

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (lead) {
      await supabase
        .from('leads')
        .update({ status: 'converted', last_msg_at: new Date().toISOString() })
        .eq('id', lead.id);
    }

    const { data: client, error: clientError } = await supabase
      .from('clients')
      .insert({
        lead_id: lead?.id || null,
        phone,
        name: name || lead?.name || null,
        email: email || null,
        program,
        program_started_at: new Date().toISOString(),
        program_ends_at: endsAt,
        paid_amount: parseInt(amount) || 0,
        checkout_id: checkout_id || null,
        folder_url: `/clients/${phone}/`,
        status: 'active',
      })
      .select()
      .single();

    if (clientError) {
      console.error('Client insert error:', clientError.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    await sendTemplate(phone, `onboard_${program}`, {
      name: client.name || 'there',
      templateParams: [client.name || 'there', durationDays.toString()],
    }, { supabase, bypassRate: true });

    if (program === '12wk') {
      try {
        const origin = `https://${req.headers.host}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch (e) {
        console.error('Week 1 program generation failed:', e.message);
      }
    }

    return res.status(200).json({ ok: true, clientId: client.id });
  } catch (err) {
    console.error('exly-webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
