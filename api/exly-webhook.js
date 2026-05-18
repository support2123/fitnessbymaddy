const crypto = require('crypto');
const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { isHinglishMarket } = require('../lib/market');

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

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  if (process.env.EXLY_WEBHOOK_SECRET) {
    const signature = req.headers['x-exly-signature'] || '';
    const expected = crypto
      .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
      .update(JSON.stringify(req.body))
      .digest('hex');
    if (signature !== expected) {
      return res.status(403).json({ error: 'invalid signature' });
    }
  }

  try {
    const {
      customer_phone, customer_name, customer_email,
      product_id, amount, checkout_id,
    } = req.body;

    if (!customer_phone) return res.status(400).json({ error: 'missing phone' });

    const db = getSupabase();
    const phone = customer_phone.replace(/[^0-9+]/g, '');
    const program = PROGRAM_MAP[product_id] || '6wk_gym';
    const durationWeeks = PROGRAM_DURATION_WEEKS[program] || 6;

    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + durationWeeks * 7 * 24 * 60 * 60 * 1000);

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .limit(1)
      .single();

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const { data: client } = await db.from('clients').insert({
      lead_id: lead?.id || null,
      phone,
      name: customer_name || lead?.name || null,
      email: customer_email || null,
      program,
      program_started_at: startDate.toISOString(),
      program_ends_at: endDate.toISOString(),
      paid_amount: amount ? parseInt(amount) : null,
      checkout_id: checkout_id || null,
      folder_url: `clients/${crypto.randomUUID()}/`,
      status: 'active',
    }).select().single();

    const market = lead?.market || 'GLOBAL';
    const hinglish = isHinglishMarket(market);
    const templateName = hinglish ? `onboard_${program}_hi` : `onboard_${program}_en`;

    await sendWhatsApp(phone, templateName, [
      customer_name || 'there',
      `${durationWeeks} weeks`,
    ]);

    if (program === '12wk') {
      const genRes = await fetch(`https://fitnessbymaddy.com/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`,
        },
        body: JSON.stringify({ client_id: client.id, week_no: 1 }),
      });

      if (!genRes.ok) {
        console.error('Week 1 generation failed for client', client.id);
      }
    }

    return res.json({ success: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'internal error' });
  }
};
