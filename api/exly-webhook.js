const { supabase } = require('./lib/supabase');
const { sendTemplate } = require('./lib/whatsapp');
const crypto = require('crypto');

const PROGRAM_DURATION = {
  '6wk_gym': 42, '6wk_home': 42, '12wk': 84,
  'pcos': 42, '40plus': 42, 'zoom_trial': 7, 'zoom_pack': 30,
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const signature = req.headers['x-exly-signature'];
  if (process.env.EXLY_WEBHOOK_SECRET && signature) {
    const expected = crypto
      .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
      .update(JSON.stringify(req.body))
      .digest('hex');
    if (signature !== expected) {
      return res.status(403).json({ error: 'Invalid signature' });
    }
  }

  const { phone, name, email, program, amount, checkout_id } = req.body;
  if (!phone || !program) {
    return res.status(400).json({ error: 'phone and program required' });
  }

  const { data: lead } = await supabase
    .from('leads')
    .select('id')
    .eq('phone', phone)
    .single();

  const durationDays = PROGRAM_DURATION[program] || 42;
  const endsAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString();

  const { data: client, error } = await supabase.from('clients').insert({
    lead_id: lead?.id || null,
    phone, name, email, program,
    program_started_at: new Date().toISOString(),
    program_ends_at: endsAt,
    paid_amount: amount,
    checkout_id,
    folder_url: null,
    status: 'active',
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });

  if (lead) {
    await supabase.from('leads')
      .update({ status: 'converted' })
      .eq('id', lead.id);
  }

  const folderPath = `clients/${client.id}`;
  await supabase.storage.from('programs').upload(
    `${folderPath}/.keep`, new Uint8Array(0), { upsert: true }
  );

  await supabase.from('clients')
    .update({ folder_url: folderPath })
    .eq('id', client.id);

  await sendTemplate(phone, `onboard_${program}`, [name || 'there']);

  return res.status(200).json({ ok: true, client_id: client.id });
};
