const crypto = require('crypto');
const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');
const { detectMarket, isHinglish } = require('./lib/market');

const PROGRAM_DURATIONS = {
  '6wk_gym': 42, '6wk_home': 42, '12wk': 84,
  'pcos': 42, '40plus': 42, 'zoom_trial': 7, 'zoom_pack': 30,
};

function verifyExlySignature(body, signature) {
  if (!process.env.EXLY_WEBHOOK_SECRET) return true;
  const hmac = crypto.createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET);
  hmac.update(JSON.stringify(body));
  return hmac.digest('hex') === signature;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const signature = req.headers['x-exly-signature'];
  if (!verifyExlySignature(req.body, signature)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const db = getSupabase();

  try {
    const { phone, email, name, product_id, checkout_id, amount, program } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone is required' });

    const programKey = program || '12wk';
    const durationDays = PROGRAM_DURATIONS[programKey] || 84;
    const now = new Date();
    const endsAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

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
      name: name || lead?.name,
      email,
      program: programKey,
      program_started_at: now.toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: parseInt(amount) || 0,
      checkout_id: checkout_id || product_id,
      folder_url: null,
      status: 'active',
    }).select().single();

    const folderPath = `clients/${client.id}`;
    await db.storage.from('clients').upload(`${folderPath}/.init`, new Blob(['']));
    await db.from('clients').update({ folder_url: folderPath }).eq('id', client.id);

    const market = detectMarket(phone);
    const hinglish = isHinglish(market);

    await sendWhatsApp({
      phone,
      templateName: `onboard_${programKey}`,
      bodyValues: hinglish
        ? [name || 'there', `Welcome to ${programKey}! Tumhara program shuru ho gaya hai. Day 7 ko check-in form aayega.`]
        : [name || 'there', `Welcome aboard! Your ${programKey} program starts now. Expect your first check-in form on Day 7.`],
    });

    if (programKey === '12wk') {
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
    }

    return res.status(200).json({ success: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
