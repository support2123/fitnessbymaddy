const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { detectMarket, isHinglish } = require('./_lib/market');
const crypto = require('crypto');

function verifySignature(body, signature) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true;
  const expected = crypto.createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature || ''), Buffer.from(expected));
}

const PROGRAM_MAP = {
  '6wk_gym': { name: '6-Week Burn & Build (Gym)', weeks: 6 },
  '6wk_home': { name: '6-Week Burn & Build (Home)', weeks: 6 },
  '12wk': { name: '12-Week Custom Training', weeks: 12 },
  'pcos': { name: 'PCOS Warrior Program', weeks: 8 },
  '40plus': { name: '40+ Strong Program', weeks: 8 },
  'zoom_trial': { name: 'Zoom Trial Session', weeks: 1 },
  'zoom_pack': { name: 'Zoom Session Pack', weeks: 4 },
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const signature = req.headers['x-exly-signature'] || '';
    if (!verifySignature(req.body, signature)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const { phone, email, name, amount, product_id, checkout_id } = req.body;
    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    const db = getSupabase();

    const programKey = product_id || '6wk_gym';
    const programInfo = PROGRAM_MAP[programKey] || PROGRAM_MAP['6wk_gym'];

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (lead) {
      await db.from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const startDate = new Date();
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + programInfo.weeks * 7);

    const { data: client, error: insertError } = await db.from('clients').insert({
      lead_id: lead?.id || null,
      phone,
      name: name || lead?.name || '',
      email: email || '',
      program: programKey,
      program_started_at: startDate.toISOString(),
      program_ends_at: endDate.toISOString(),
      paid_amount: amount || 0,
      checkout_id: checkout_id || '',
      status: 'active'
    }).select().single();

    if (insertError) throw insertError;

    const folderPath = `clients/${client.id}`;
    await db.storage.from('client-files').upload(
      `${folderPath}/.keep`,
      new Uint8Array(0),
      { contentType: 'application/octet-stream', upsert: true }
    );

    await db.from('clients')
      .update({ folder_url: folderPath })
      .eq('id', client.id);

    const market = detectMarket(phone);
    const hinglish = isHinglish(market);

    const welcomeMsg = hinglish
      ? `Welcome to ${programInfo.name}! Aapka program start ho gaya hai. Pehla check-in Day 7 pe aayega. Koi bhi doubt ho toh yahan message karo.`
      : `Welcome to ${programInfo.name}! Your program has started. Your first check-in will be on Day 7. Message here if you have any questions.`;

    await sendWhatsApp({
      phone,
      templateName: `onboard_${programKey}`,
      body: welcomeMsg,
      params: [name || 'there', programInfo.name]
    });

    if (programKey === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://fitnessbymaddy.com';
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (e) {
        console.error('Week-1 generation trigger failed:', e.message);
      }
    }

    return res.status(200).json({ ok: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
