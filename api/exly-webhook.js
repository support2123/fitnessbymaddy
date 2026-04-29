const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/market');

const PROGRAM_MAP = {
  '6wk-burn-build': '6wk_gym',
  '6wk-home': '6wk_home',
  '12wk-flagship': '12wk',
  'pcos-warrior': 'pcos',
  '40plus-strong': '40plus',
  'zoom-trial': 'zoom_trial',
  'zoom-pack': 'zoom_pack'
};

const PROGRAM_DURATIONS = {
  '6wk_gym': 42, '6wk_home': 42, '12wk': 84,
  'pcos': 42, '40plus': 42, 'zoom_trial': 7, 'zoom_pack': 28
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const secret = req.headers['x-webhook-secret'] || req.headers['x-exly-secret'];
    if (secret && secret !== process.env.EXLY_WEBHOOK_SECRET) {
      return res.status(401).json({ error: 'Invalid webhook secret' });
    }

    const {
      phone, email, name, product_id, checkout_id,
      amount, status: paymentStatus
    } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone required' });
    if (paymentStatus && paymentStatus !== 'completed' && paymentStatus !== 'success') {
      if (paymentStatus === 'failed') {
        await handlePaymentFailure(phone, name);
      }
      return res.status(200).json({ action: 'payment_not_completed', status: paymentStatus });
    }

    const db = getSupabase();
    const program = PROGRAM_MAP[product_id] || '6wk_gym';
    const now = new Date();
    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const endsAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

    let { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    } else {
      const { data: newLead } = await db.from('leads').insert({
        phone, name, source: 'exly_direct', status: 'converted'
      }).select().single();
      lead = newLead;
    }

    const { data: client, error } = await db.from('clients').insert({
      lead_id: lead.id,
      phone,
      name: name || lead.name,
      email,
      program,
      program_started_at: now.toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: amount ? parseInt(amount, 10) : 0,
      checkout_id,
      folder_url: `/clients/${lead.id}/`,
      status: 'active'
    }).select().single();

    if (error) throw error;

    await sendWhatsApp(phone, `onboard_${program}`, [
      name || 'there',
      `Week 1 starts now! Your first check-in is in 7 days.`
    ]);

    if (program === '12wk') {
      try {
        const origin = `https://${req.headers.host}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (genErr) {
        console.error('Week-1 program generation failed:', genErr.message);
      }
    }

    return res.status(200).json({
      success: true,
      client_id: client.id,
      program,
      starts: now.toISOString(),
      ends: endsAt.toISOString()
    });

  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function handlePaymentFailure(phone, name) {
  const db = getSupabase();
  const { data: client } = await db
    .from('clients')
    .select('id, status')
    .eq('phone', phone)
    .eq('status', 'active')
    .single();

  if (client) {
    await sendWhatsApp('917082478374', 'escalation_alert', [
      'Payment failure for active client',
      maskPhone(phone)
    ]);
  }
}
