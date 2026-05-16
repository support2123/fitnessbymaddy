const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const crypto = require('crypto');

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

  const db = getSupabase();
  const { phone, email, name, product_id, amount, checkout_id } = req.body;

  if (!phone || !product_id) {
    return res.status(400).json({ error: 'Missing phone or product_id' });
  }

  const program = PROGRAM_MAP[product_id] || product_id;
  const durationDays = PROGRAM_DURATIONS[program] || 42;

  const { data: lead } = await db
    .from('leads')
    .select('id')
    .eq('phone', phone)
    .single();

  if (lead) {
    await db.from('leads')
      .update({ status: 'converted' })
      .eq('id', lead.id);
  }

  const programEnds = new Date();
  programEnds.setDate(programEnds.getDate() + durationDays);

  const { data: client, error } = await db.from('clients').insert({
    lead_id: lead?.id || null,
    phone,
    name: name || null,
    email: email || null,
    program,
    program_ends_at: programEnds.toISOString(),
    paid_amount: parseInt(amount) || 0,
    checkout_id: checkout_id || null,
    folder_url: `/clients/${checkout_id || 'unknown'}/`
  }).select().single();

  if (error) {
    console.error('Client creation failed:', error.message);
    return res.status(500).json({ error: 'Failed to create client' });
  }

  await sendWhatsApp(phone, `onboard_${program}`, {
    name: name || 'there',
    templateParams: [name || 'Champion', program.replace(/_/g, ' ')]
  });

  if (program === '12wk') {
    try {
      const origin = `https://${req.headers.host}`;
      await fetch(`${origin}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: client.id, week_no: 1 })
      });
    } catch (e) {
      console.error('Week-1 generation failed:', e.message);
    }
  }

  return res.status(200).json({ success: true, client_id: client.id });
};
