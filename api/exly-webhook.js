const { getSupabase } = require('./_lib/supabase');
const { sendTemplate } = require('./_lib/whatsapp');
const { detectMarket } = require('./_lib/market');
const { maskPhone } = require('./_lib/pii');

const crypto = require('crypto');

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

  try {
    const secret = process.env.EXLY_WEBHOOK_SECRET;
    if (secret) {
      const sig = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'] || '';
      const expected = crypto.createHmac('sha256', secret).update(JSON.stringify(req.body)).digest('hex');
      if (sig && sig !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const {
      phone, name, email, amount, checkout_id, product_id,
      program,
    } = req.body;

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    const normalizedPhone = normalizePhone(phone);
    const programKey = program || mapProduct(product_id);

    const db = getSupabase();

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', normalizedPhone)
      .single();

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const durationDays = PROGRAM_DURATIONS[programKey] || 42;
    const endsAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString();

    const { data: client } = await db.from('clients').insert({
      lead_id: lead?.id || null,
      phone: normalizedPhone,
      name: name || lead?.name,
      email,
      program: programKey,
      program_started_at: new Date().toISOString(),
      program_ends_at: endsAt,
      paid_amount: amount || 0,
      checkout_id,
      status: 'active',
    }).select().single();

    const folderPath = `clients/${client.id}`;
    await db.from('clients').update({ folder_url: folderPath }).eq('id', client.id);

    const { market } = detectMarket(normalizedPhone);
    const lang = market === 'IN' ? 'hi' : 'en';
    const template = lang === 'hi' ? `onboard_${programKey}_hi` : `onboard_${programKey}`;

    await sendTemplate(normalizedPhone, template, [
      client.name || 'there',
      programKey.replace(/_/g, ' '),
    ]);

    if (programKey === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://fitnessbymaddy.com';
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch (err) {
        console.error('Failed to trigger week-1 generation:', err.message);
      }
    }

    console.log(`Converted: ${maskPhone(normalizedPhone)} → ${programKey}`);

    return res.status(200).json({
      success: true,
      client_id: client.id,
      program: programKey,
    });

  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function normalizePhone(raw) {
  let phone = (raw || '').replace(/[^0-9+]/g, '');
  if (!phone.startsWith('+') && phone.length >= 10) phone = '+' + phone;
  return phone;
}

function mapProduct(productId) {
  const map = {
    '6wk_gym': '6wk_gym',
    '6wk_home': '6wk_home',
    '12wk': '12wk',
    'pcos': 'pcos',
    '40plus': '40plus',
    'zoom_trial': 'zoom_trial',
    'zoom_pack': 'zoom_pack',
  };
  return map[productId] || 'zoom_trial';
}
