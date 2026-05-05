const { supabase } = require('./lib/supabase');
const { sendTemplate } = require('./lib/whatsapp');

const PROGRAM_MAP = {
  '6wk-shred': '6wk_gym',
  '6wk-home': '6wk_home',
  '12wk-custom': '12wk',
  'pcos-warrior': 'pcos',
  '40plus-strong': '40plus',
  'zoom-trial': 'zoom_trial',
  'zoom-pack': 'zoom_pack'
};

const PROGRAM_DURATIONS = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 28
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secret = req.headers['x-webhook-secret'] || req.headers['x-exly-secret'];
  if (secret !== process.env.EXLY_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const {
      phone, email, name, checkout_id, product_id, amount
    } = req.body;

    if (!phone || !checkout_id) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const program = PROGRAM_MAP[product_id] || '6wk_gym';
    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const now = new Date();
    const endsAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

    const { data: lead } = await supabase
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .single();

    const { data: client, error } = await supabase
      .from('clients')
      .insert({
        lead_id: lead?.id || null,
        phone,
        name: name || '',
        email: email || '',
        program,
        program_started_at: now.toISOString(),
        program_ends_at: endsAt.toISOString(),
        paid_amount: parseFloat(amount) || 0,
        checkout_id,
        status: 'active'
      })
      .select()
      .single();

    if (error) {
      console.error('Client creation error:', error.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    if (lead) {
      await supabase
        .from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const folderPath = `clients/${client.id}`;
    await supabase.storage
      .from('programs')
      .upload(`${folderPath}/.keep`, new Blob(['']));

    await sendTemplate(phone, `onboard_${program}`, [
      name || 'there',
      String(durationDays / 7)
    ]);

    if (program === '12wk') {
      await fetch(`${process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : ''}/api/generate-program`, {
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
