const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');
const crypto = require('crypto');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getSupabase();

  try {
    const signature = req.headers['x-exly-signature'];
    if (process.env.EXLY_WEBHOOK_SECRET && signature) {
      const expected = crypto
        .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (signature !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const { email, phone, name, amount, checkout_id, product_name } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'No phone in payload' });
    }

    const programMap = {
      '6 week shred': '6wk_gym',
      '6 week home': '6wk_home',
      '12 week': '12wk',
      'pcos': 'pcos',
      '40+': '40plus',
      'zoom trial': 'zoom_trial',
      'zoom pack': 'zoom_pack',
    };

    let program = 'zoom_trial';
    const pName = (product_name || '').toLowerCase();
    for (const [key, val] of Object.entries(programMap)) {
      if (pName.includes(key)) {
        program = val;
        break;
      }
    }

    const programDurations = {
      '6wk_gym': 42,
      '6wk_home': 42,
      '12wk': 84,
      'pcos': 42,
      '40plus': 42,
      'zoom_trial': 7,
      'zoom_pack': 30,
    };

    const durationDays = programDurations[program] || 42;
    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + durationDays * 24 * 60 * 60 * 1000);

    const { data: lead } = await db
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .limit(1)
      .single();

    if (lead) {
      await db.from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const { data: client, error: insertErr } = await db.from('clients').insert({
      lead_id: lead ? lead.id : null,
      phone,
      name: name || null,
      email: email || null,
      program,
      program_started_at: startDate.toISOString(),
      program_ends_at: endDate.toISOString(),
      paid_amount: amount || 0,
      checkout_id: checkout_id || null,
      folder_url: null,
      status: 'active'
    }).select().single();

    if (insertErr) {
      console.error('Client insert error:', insertErr.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    const folderPath = `clients/${client.id}`;
    await db.storage.from('programs').upload(`${folderPath}/.keep`, new Uint8Array(0), {
      contentType: 'application/octet-stream',
      upsert: true
    });

    await db.from('clients')
      .update({ folder_url: folderPath })
      .eq('id', client.id);

    await sendWhatsApp(phone, `onboard_${program}`, [name || 'there']);

    if (program === '12wk') {
      await fetch(`https://fitnessbymaddy.com/api/generate-program`, {
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
