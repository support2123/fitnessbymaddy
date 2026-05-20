const crypto = require('crypto');
const { supabase } = require('../lib/supabase');
const { sendToClient, notifyMaddy } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/market');

const PROGRAM_MAP = {
  '6_week_shred_gym': '6wk_gym',
  '6_week_shred_home': '6wk_home',
  '12_week_custom': '12wk',
  'pcos_warrior': 'pcos',
  '40_plus_strong': '40plus',
  'zoom_trial': 'zoom_trial',
  'zoom_pack': 'zoom_pack',
};

const PROGRAM_DURATIONS = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 28,
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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

    const { phone, name, email, product_name, amount, checkout_id } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone number' });
    }

    const program = PROGRAM_MAP[product_name] || 'zoom_trial';
    const durationDays = PROGRAM_DURATIONS[program] || 42;

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .limit(1)
      .single();

    if (lead) {
      await supabase.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const now = new Date();
    const endsAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id')
      .eq('phone', phone)
      .eq('status', 'active')
      .limit(1)
      .single();

    let client;

    if (existingClient) {
      const { data: updated } = await supabase.from('clients').update({
        program,
        paid_amount: amount ? parseInt(amount) : null,
        checkout_id,
        program_started_at: now.toISOString(),
        program_ends_at: endsAt.toISOString(),
      }).eq('id', existingClient.id).select().single();
      client = updated;
    } else {
      const { data: created, error } = await supabase.from('clients').insert({
        lead_id: lead?.id || null,
        phone,
        name: name || lead?.name || null,
        email: email || null,
        program,
        paid_amount: amount ? parseInt(amount) : null,
        checkout_id,
        program_started_at: now.toISOString(),
        program_ends_at: endsAt.toISOString(),
        folder_url: null,
        status: 'active',
      }).select().single();

      if (error) {
        console.error(`Exly webhook error: ${error.message}`);
        return res.status(500).json({ error: 'Failed to create client' });
      }
      client = created;
    }

    const folderPath = `clients/${client.id}/`;
    await supabase.storage.from('clients').upload(
      `${client.id}/.keep`,
      new Uint8Array(0),
      { contentType: 'application/octet-stream', upsert: true }
    );

    await supabase.from('clients').update({
      folder_url: folderPath,
    }).eq('id', client.id);

    await sendToClient(phone, `onboard_${program}`, [
      name || 'there',
      String(durationDays / 7),
    ]);

    if (program === '12wk') {
      try {
        const baseUrl = `https://${req.headers.host}`;
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch (genErr) {
        console.error('Week-1 program generation failed:', genErr.message);
      }
    }

    console.log(`Conversion: ${maskPhone(phone)}, program: ${program}, client: ${client.id}`);
    return res.status(200).json({ status: 'converted', client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    await notifyMaddy('Payment webhook error', err.message).catch(() => {});
    return res.status(500).json({ error: 'Internal server error' });
  }
};
