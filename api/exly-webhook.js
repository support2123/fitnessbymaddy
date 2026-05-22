const crypto = require('crypto');
const { getSupabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');

const PROGRAM_MAP = {
  '6_week_shred': '6wk_gym',
  '6_week_home': '6wk_home',
  '12_week_custom': '12wk',
  'pcos_warrior': 'pcos',
  '40_plus_strong': '40plus',
  'zoom_trial': 'zoom_trial',
  'zoom_pack': 'zoom_pack',
};

const PROGRAM_DURATION_WEEKS = {
  '6wk_gym': 6,
  '6wk_home': 6,
  '12wk': 12,
  'pcos': 8,
  '40plus': 8,
  'zoom_trial': 1,
  'zoom_pack': 4,
};

function verifyWebhookSignature(body, signature) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true;
  const expected = crypto.createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature || ''), Buffer.from(expected));
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const signature = req.headers['x-exly-signature'];
    if (process.env.EXLY_WEBHOOK_SECRET && !verifyWebhookSignature(req.body, signature)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const {
      customer_phone,
      customer_name,
      customer_email,
      product_name,
      product_id,
      amount,
      checkout_id,
      status,
    } = req.body;

    if (status !== 'paid' && status !== 'completed') {
      if (status === 'failed') {
        const { data: activeClient } = await getSupabase()
          .from('clients')
          .select('id, phone')
          .eq('phone', customer_phone)
          .eq('status', 'active')
          .maybeSingle();

        if (activeClient) {
          const { escalateToMaddy } = require('../lib/escalation');
          await escalateToMaddy(customer_phone, 'payment_failure', `Payment failed for ${customer_name}: ${product_name}`, activeClient.id);
        }
      }
      return res.status(200).json({ action: 'non_paid_status', status });
    }

    const phone = customer_phone;
    if (!phone) return res.status(400).json({ error: 'Missing customer phone' });

    const sb = getSupabase();
    const market = detectMarket(phone);
    const program = PROGRAM_MAP[product_id] || PROGRAM_MAP[product_name?.toLowerCase()?.replace(/\s+/g, '_')] || '12wk';
    const durationWeeks = PROGRAM_DURATION_WEEKS[program] || 12;

    const now = new Date();
    const endsAt = new Date(now.getTime() + durationWeeks * 7 * 24 * 60 * 60 * 1000);

    const { data: lead } = await sb
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .maybeSingle();

    if (lead) {
      await sb.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    } else {
      const { data: newLead } = await sb.from('leads').insert({
        phone,
        name: customer_name,
        status: 'converted',
        market,
        source: 'exly_direct',
      }).select('id').single();
      if (newLead) lead = newLead;
    }

    const { data: client, error } = await sb.from('clients').insert({
      lead_id: lead?.id,
      phone,
      name: customer_name,
      email: customer_email,
      program,
      program_started_at: now.toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: amount ? Math.round(parseFloat(amount) * 100) : null,
      checkout_id,
      status: 'active',
    }).select().single();

    if (error) {
      console.error('Client creation error:', error.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    const folderPath = `${client.id}/`;
    await sb.storage.from('clients').upload(`${folderPath}.keep`, Buffer.from(''), { upsert: true });
    await sb.from('clients').update({ folder_url: folderPath }).eq('id', client.id);

    const templateName = `onboard_${program}`;
    await sendTemplate(phone, templateName, {
      name: customer_name || 'there',
      templateParams: isHinglish(market)
        ? [customer_name || 'there', `Welcome to the family! Aapka ${product_name || program} program start ho gaya hai.`]
        : [customer_name || 'there', `Welcome! Your ${product_name || program} program is now active.`],
    });

    if (program === '12wk') {
      const origin = `https://${req.headers.host || 'www.fitnessbymaddy.com'}`;
      fetch(`${origin}/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`,
        },
        body: JSON.stringify({ client_id: client.id, week_no: 1 }),
      }).catch(err => console.error('Week-1 program generation trigger failed:', err.message));
    }

    return res.status(200).json({ success: true, client_id: client.id });

  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
