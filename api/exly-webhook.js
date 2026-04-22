const { supabase } = require('./lib/supabase');
const { sendTemplate, detectMarket, isHinglish } = require('./lib/whatsapp');
const { escalateToMaddy } = require('./lib/escalation');
const crypto = require('crypto');

const PROGRAM_DURATIONS = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 30
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    if (process.env.EXLY_WEBHOOK_SECRET) {
      const sig = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'] || '';
      const expected = crypto
        .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (sig && sig !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const {
      phone, email, name, amount, checkout_id,
      product_name, product_id, status: paymentStatus
    } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone is required' });

    if (paymentStatus === 'failed') {
      const { data: lead } = await supabase
        .from('leads')
        .select('id')
        .eq('phone', phone)
        .single();
      if (lead) {
        await escalateToMaddy('Payment failed', `Phone: ${phone}, Amount: ${amount}`);
      }
      return res.status(200).json({ action: 'payment_failed_logged' });
    }

    let { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!lead) {
      const market = detectMarket(phone);
      const { data: newLead } = await supabase.from('leads').insert({
        phone,
        name,
        source: 'exly',
        status: 'new',
        market
      }).select().single();
      lead = newLead;
    }

    await supabase.from('leads').update({ status: 'converted' }).eq('id', lead.id);

    const program = lead.program_interest || product_id || '12wk';
    const durationDays = PROGRAM_DURATIONS[program] || 84;
    const programEnds = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000);

    const { data: client } = await supabase.from('clients').insert({
      lead_id: lead.id,
      phone,
      name: name || lead.name,
      email,
      program,
      program_started_at: new Date().toISOString(),
      program_ends_at: programEnds.toISOString(),
      paid_amount: amount,
      checkout_id,
      folder_url: `/clients/${lead.id}/`,
      status: 'active'
    }).select().single();

    const folderPath = `clients/${client.id}/`;
    await supabase.storage.from('clients').upload(
      `${folderPath}.keep`,
      new Uint8Array(0),
      { contentType: 'text/plain', upsert: true }
    );

    const market = lead.market || detectMarket(phone);
    await sendTemplate(phone, `onboard_${program}`, [name || 'there']);

    if (program === '12wk') {
      const generateUrl = `${process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : ''}/api/generate-program`;
      try {
        await fetch(generateUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`
          },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (e) {
        console.error('Failed to trigger program generation:', e.message);
      }
    }

    return res.status(200).json({
      action: 'converted',
      client_id: client.id,
      program
    });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
