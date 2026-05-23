const crypto = require('crypto');
const { getSupabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');

function verifyExlySignature(body, signature) {
  if (!process.env.EXLY_WEBHOOK_SECRET) return true;
  const expected = crypto
    .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
    .update(JSON.stringify(body))
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature || ''),
    Buffer.from(expected)
  );
}

const PROGRAM_MAP = {
  '6wk_gym': { name: '6-Week Burn & Build (Gym)', weeks: 6, template: 'onboard_6wk' },
  '6wk_home': { name: '6-Week Burn & Build (Home)', weeks: 6, template: 'onboard_6wk' },
  '12wk': { name: '12-Week Flagship', weeks: 12, template: 'onboard_12wk' },
  'pcos': { name: 'PCOS Warrior', weeks: 8, template: 'onboard_pcos' },
  '40plus': { name: '40+ Strong', weeks: 8, template: 'onboard_40plus' },
  'zoom_trial': { name: 'Zoom Trial', weeks: 1, template: 'onboard_trial' },
  'zoom_pack': { name: 'Zoom Pack', weeks: 4, template: 'onboard_zoom' }
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const signature = req.headers['x-exly-signature'] || '';
    if (!verifyExlySignature(req.body, signature)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const { phone, email, name, product_id, amount, checkout_id } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone required' });

    const db = getSupabase();
    const program = product_id && PROGRAM_MAP[product_id]
      ? product_id
      : '6wk_gym';
    const programInfo = PROGRAM_MAP[program];
    const market = detectMarket(phone);

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .limit(1)
      .single();

    if (lead) {
      await db.from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + programInfo.weeks * 7);

    const { data: client, error: clientErr } = await db.from('clients').insert({
      lead_id: lead ? lead.id : null,
      phone,
      name: name || (lead ? lead.name : null),
      email: email || null,
      program,
      program_started_at: startDate.toISOString(),
      program_ends_at: endDate.toISOString(),
      paid_amount: amount ? parseFloat(amount) : null,
      checkout_id: checkout_id || null,
      folder_url: null,
      status: 'active'
    }).select().single();

    if (clientErr) throw clientErr;

    const folderPath = `clients/${client.id}/`;
    await db.storage.from('programs').upload(
      `${folderPath}.keep`,
      Buffer.from(''),
      { contentType: 'text/plain', upsert: true }
    );

    await db.from('clients')
      .update({ folder_url: folderPath })
      .eq('id', client.id);

    await sendTemplate(phone, programInfo.template, {
      name: name || 'there',
      templateParams: [
        name || 'there',
        programInfo.name,
        startDate.toLocaleDateString('en-IN')
      ]
    });

    if (program === '12wk') {
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'https://fitnessbymaddy.com';

      await fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: client.id, week_no: 1 })
      });
    }

    return res.status(200).json({ success: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
