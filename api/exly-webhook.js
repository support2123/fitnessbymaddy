const crypto = require('crypto');
const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/pii');

const PROGRAM_DURATIONS = {
  '6wk_gym': 42, '6wk_home': 42,
  '12wk': 84, 'pcos': 42,
  '40plus': 42, 'zoom_trial': 7, 'zoom_pack': 30
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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

  try {
    const db = getSupabase();
    const {
      phone, name, email, checkout_id,
      program, paid_amount
    } = req.body;

    if (!phone || !program) {
      return res.status(400).json({ error: 'Missing phone or program' });
    }

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const duration = PROGRAM_DURATIONS[program] || 42;
    const endsAt = new Date();
    endsAt.setDate(endsAt.getDate() + duration);

    const { data: client, error } = await db.from('clients').insert({
      lead_id: lead?.id || null,
      phone,
      name: name || lead?.name || null,
      email,
      program,
      program_started_at: new Date().toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: paid_amount || null,
      checkout_id: checkout_id || null,
      folder_url: null,
      status: 'active'
    }).select().single();

    if (error) {
      console.error('Client insert error:', error.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    const folderPath = `clients/${client.id}/`;
    await db.storage.from('client-files').upload(
      `${folderPath}.keep`,
      '',
      { contentType: 'text/plain', upsert: true }
    );

    await db.from('clients').update({
      folder_url: folderPath
    }).eq('id', client.id);

    const onboardMsg = `Welcome to FitnessByMaddy! Your ${program.replace(/_/g, ' ')} program starts now.\n\nYou'll receive your first check-in form in 7 days. Let's go!`;
    await sendWhatsApp(phone, onboardMsg, `onboard_${program}`);

    if (program === '12wk') {
      try {
        const origin = `https://${req.headers.host}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': process.env.INTERNAL_API_KEY
          },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (genErr) {
        console.error('Week 1 generation failed:', genErr.message);
      }
    }

    return res.status(200).json({ success: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', maskPhone(req.body?.phone), err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
