const { getSupabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { logMessage } = require('../lib/rate-limit');
const crypto = require('crypto');

const PROGRAM_MAP = {
  '6wk_gym': { duration: 42, label: '6-Week Burn & Build (Gym)' },
  '6wk_home': { duration: 42, label: '6-Week Burn & Build (Home)' },
  '12wk': { duration: 84, label: '12-Week Flagship' },
  'pcos': { duration: 42, label: 'PCOS Warrior' },
  '40plus': { duration: 42, label: '40+ Strong' },
  'zoom_trial': { duration: 7, label: 'Zoom Trial' },
  'zoom_pack': { duration: 30, label: 'Zoom Pack' },
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (secret) {
    const sig = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'];
    if (sig) {
      const expected = crypto.createHmac('sha256', secret).update(JSON.stringify(req.body)).digest('hex');
      if (sig !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }
  }

  try {
    const { phone, email, name, program, amount, checkout_id } = req.body;
    if (!phone || !program) {
      return res.status(400).json({ error: 'phone and program required' });
    }

    const supabase = getSupabase();
    const programInfo = PROGRAM_MAP[program] || { duration: 42, label: program };
    const now = new Date();
    const endsAt = new Date(now.getTime() + programInfo.duration * 24 * 60 * 60 * 1000);

    const { data: lead } = await supabase
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .single();

    if (lead) {
      await supabase
        .from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const { data: client, error } = await supabase
      .from('clients')
      .insert({
        lead_id: lead?.id || null,
        phone,
        name: name || null,
        email: email || null,
        program,
        program_started_at: now.toISOString(),
        program_ends_at: endsAt.toISOString(),
        paid_amount: amount ? parseInt(amount) : null,
        checkout_id: checkout_id || null,
        folder_url: null,
        status: 'active',
      })
      .select()
      .single();

    if (error) {
      console.error('[Exly DB Error]', error.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    const folderPath = `clients/${client.id}`;
    await supabase.storage.from('client-files').upload(
      `${folderPath}/.keep`,
      new Uint8Array(0),
      { contentType: 'text/plain', upsert: true }
    );

    await supabase
      .from('clients')
      .update({ folder_url: folderPath })
      .eq('id', client.id);

    await sendTemplate(phone, `onboard_${program}`, {
      name: name || 'there',
      templateParams: [name || 'there', programInfo.label],
    });
    await logMessage(phone, 'out', `Onboarding: ${programInfo.label}`, `onboard_${program}`);

    if (program === '12wk') {
      try {
        const baseUrl = `https://${req.headers.host}`;
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`
          },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (genErr) {
        console.error('[Week1 Gen Error]', genErr.message);
      }
    }

    return res.status(200).json({ ok: true, client_id: client.id });
  } catch (err) {
    console.error('[Exly Webhook Error]', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
