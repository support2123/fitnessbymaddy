const crypto = require('crypto');
const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');

const PROGRAM_MAP = {
  'shred': '6wk_gym',
  '6-week-shred': '6wk_gym',
  '6wk-home': '6wk_home',
  'pcos': 'pcos',
  'pcos-warrior': 'pcos',
  '40plus': '40plus',
  '40-plus-strong': '40plus',
  'custom': '12wk',
  '12-week': '12wk',
  '12-week-custom': '12wk',
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
  'zoom_pack': 30,
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getSupabase();

  try {
    if (process.env.EXLY_WEBHOOK_SECRET) {
      const sig = req.headers['x-exly-signature'];
      const expected = crypto
        .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (sig !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const { phone, email, name, product_id, amount, checkout_id } = req.body;

    if (!phone || !product_id) {
      return res.status(400).json({ error: 'Missing phone or product_id' });
    }

    const program = PROGRAM_MAP[product_id] || '6wk_gym';
    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const programEnds = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString();

    const { data: lead } = await db
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .single();

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const { data: client, error } = await db.from('clients').insert({
      lead_id: lead?.id || null,
      phone,
      name: name || null,
      email: email || null,
      program,
      program_started_at: new Date().toISOString(),
      program_ends_at: programEnds,
      paid_amount: amount ? parseInt(amount) : null,
      checkout_id: checkout_id || null,
      folder_url: null,
      status: 'active',
    }).select().single();

    if (error) {
      console.error('Client insert error:', error.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    const folderPath = `clients/${client.id}`;
    await db.storage.from('clients').upload(`${folderPath}/.keep`, new Uint8Array(0), {
      contentType: 'application/octet-stream',
      upsert: true,
    });

    await db.from('clients').update({ folder_url: folderPath }).eq('id', client.id);

    await sendWhatsApp(phone, `onboard_${program}`, [
      name || 'Champion',
      program,
    ]);

    if (program === '12wk') {
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'https://fitnessbymaddy.com';

      await fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.INTERNAL_API_KEY}`,
        },
        body: JSON.stringify({ client_id: client.id, week_no: 1 }),
      });
    }

    return res.status(200).json({ success: true, clientId: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
