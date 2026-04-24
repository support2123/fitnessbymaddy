const crypto = require('crypto');
const { getSupabase } = require('./lib/supabase');
const { sendTemplate } = require('./lib/whatsapp');
const { detectMarket } = require('./lib/market');
const { maskPhone } = require('./lib/whatsapp');

const PROGRAM_MAP = {
  '6-week-burn-build': '6wk_gym',
  '6-week-home': '6wk_home',
  '12-week-flagship': '12wk',
  'pcos-warrior': 'pcos',
  '40-plus-strong': '40plus',
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
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (secret) {
    const signature = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'];
    if (signature) {
      const expected = crypto
        .createHmac('sha256', secret)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (signature !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }
  }

  const {
    customer_phone,
    customer_name,
    customer_email,
    product_name,
    product_id,
    checkout_id,
    amount,
    currency,
    status,
  } = req.body;

  if (status && status !== 'completed' && status !== 'success') {
    return res.status(200).json({ ok: true, skipped: 'not a successful purchase' });
  }

  if (!customer_phone) {
    return res.status(400).json({ error: 'customer_phone is required' });
  }

  const db = getSupabase();

  try {
    const phone = customer_phone.replace(/[^0-9+]/g, '');
    const program = PROGRAM_MAP[product_id] || PROGRAM_MAP[product_name] || '12wk';
    const durationDays = PROGRAM_DURATIONS[program] || 42;

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .maybeSingle();

    let leadId = lead?.id;
    if (!lead) {
      const { data: newLead } = await db
        .from('leads')
        .insert({
          phone,
          name: customer_name,
          source: 'exly_purchase',
          status: 'converted',
          market: detectMarket(phone),
        })
        .select()
        .single();
      leadId = newLead.id;
    } else {
      await db
        .from('leads')
        .update({ status: 'converted', name: customer_name || lead.name })
        .eq('id', lead.id);
    }

    const now = new Date();
    const endsAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);
    const folderPath = `clients/${leadId}`;

    const { data: client } = await db
      .from('clients')
      .insert({
        lead_id: leadId,
        phone,
        name: customer_name,
        email: customer_email,
        program,
        program_started_at: now.toISOString(),
        program_ends_at: endsAt.toISOString(),
        paid_amount: amount ? parseInt(amount) : null,
        checkout_id: checkout_id || product_id,
        folder_url: folderPath,
        status: 'active',
      })
      .select()
      .single();

    const templateName = `onboard_${program}`;
    await sendTemplate(phone, templateName, [
      customer_name || 'there',
      program,
    ]);

    if (program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://www.fitnessbymaddy.com';
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`,
          },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch (genErr) {
        console.error('Week-1 program generation failed:', genErr.message);
      }
    }

    return res.status(200).json({ ok: true, client_id: client.id, program });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
