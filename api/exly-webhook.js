const { getSupabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/market');
const crypto = require('crypto');

const PROGRAM_MAP = {
  '6wk_gym': { weeks: 6, label: '6-Week Burn & Build (Gym)' },
  '6wk_home': { weeks: 6, label: '6-Week Burn & Build (Home)' },
  '12wk': { weeks: 12, label: '12-Week Flagship' },
  'pcos': { weeks: 8, label: 'PCOS Warrior' },
  '40plus': { weeks: 8, label: '40+ Strong' },
  'zoom_trial': { weeks: 1, label: 'Zoom Trial' },
  'zoom_pack': { weeks: 4, label: 'Zoom Pack' },
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  // Verify webhook signature if secret is configured
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (secret) {
    const sig = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'];
    if (sig) {
      const expected = crypto.createHmac('sha256', secret).update(JSON.stringify(req.body)).digest('hex');
      if (sig !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }
  }

  const sb = getSupabase();

  try {
    const {
      phone, email, name, program, amount,
      checkout_id, order_id,
    } = req.body;

    if (!phone || !program) {
      return res.status(400).json({ error: 'phone and program required' });
    }

    console.log(`[EXLY] Purchase: ${maskPhone(phone)} → ${program}`);

    const programInfo = PROGRAM_MAP[program] || { weeks: 6, label: program };
    const now = new Date();
    const endsAt = new Date(now);
    endsAt.setDate(endsAt.getDate() + programInfo.weeks * 7);

    // Find or create lead
    let { data: lead } = await sb
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .single();

    if (!lead) {
      const { data: newLead } = await sb
        .from('leads')
        .insert({ phone, name, source: 'exly', status: 'converted' })
        .select()
        .single();
      lead = newLead;
    } else {
      await sb.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    // Create client
    const { data: client, error } = await sb
      .from('clients')
      .insert({
        lead_id: lead.id,
        phone, name, email, program,
        program_started_at: now.toISOString(),
        program_ends_at: endsAt.toISOString(),
        paid_amount: amount ? parseInt(amount) : null,
        checkout_id: checkout_id || order_id || null,
        folder_url: `/clients/${lead.id}/`,
        status: 'active',
      })
      .select()
      .single();

    if (error) throw error;

    // Create storage folder marker
    await sb.storage
      .from('clients')
      .upload(`${client.id}/.init`, Buffer.from(''), { upsert: true });

    // Send onboarding WhatsApp
    await sendTemplate(phone, `onboard_${program}`, {
      name: name || 'there',
      templateParams: [name || 'there', programInfo.label, `${programInfo.weeks} weeks`],
    });

    // For 12-week programs, trigger immediate Week-1 generation
    if (program === '12wk') {
      const origin = `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}`;
      fetch(`${origin}/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        },
        body: JSON.stringify({ client_id: client.id, week_no: 1 }),
      }).catch((err) => console.error(`[EXLY] Week-1 trigger failed: ${err.message}`));
    }

    return res.status(200).json({ ok: true, client_id: client.id });
  } catch (err) {
    console.error(`[EXLY] Error: ${err.message}`);
    return res.status(500).json({ error: 'Failed to process purchase' });
  }
};
