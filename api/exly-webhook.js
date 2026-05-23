const crypto = require('crypto');
const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');

const PROGRAM_MAP = {
  '6_week_shred_gym': '6wk_gym',
  '6_week_shred_home': '6wk_home',
  '12_week_custom': '12wk',
  'pcos_warrior': 'pcos',
  '40_plus_strong': '40plus',
  'zoom_trial': 'zoom_trial',
  'zoom_pack': 'zoom_pack'
};

const PROGRAM_DURATIONS = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 30
};

function verifySignature(body, signature) {
  if (!process.env.EXLY_WEBHOOK_SECRET) return true;
  const expected = crypto
    .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
    .update(JSON.stringify(body))
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature || ''),
    Buffer.from(expected)
  );
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const signature = req.headers['x-exly-signature'];
  if (process.env.EXLY_WEBHOOK_SECRET && !verifySignature(req.body, signature)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const db = getSupabase();
  const {
    buyer_phone, buyer_name, buyer_email,
    product_id, product_name, amount, checkout_id
  } = req.body;

  if (!buyer_phone) {
    return res.status(400).json({ error: 'Missing buyer_phone' });
  }

  const program = PROGRAM_MAP[product_id] || PROGRAM_MAP[product_name] || '12wk';
  const durationDays = PROGRAM_DURATIONS[program] || 84;

  const startDate = new Date();
  const endDate = new Date(startDate.getTime() + durationDays * 86400000);

  const { data: lead } = await db.from('leads')
    .select('id')
    .eq('phone', buyer_phone)
    .single();

  if (lead) {
    await db.from('leads')
      .update({ status: 'converted' })
      .eq('id', lead.id);
  }

  const folderPath = `clients/${crypto.randomUUID()}`;

  const { data: client, error } = await db.from('clients').insert({
    lead_id: lead?.id || null,
    phone: buyer_phone,
    name: buyer_name,
    email: buyer_email,
    program,
    program_started_at: startDate.toISOString(),
    program_ends_at: endDate.toISOString(),
    paid_amount: amount,
    checkout_id,
    folder_url: folderPath,
    status: 'active'
  }).select().single();

  if (error) {
    return res.status(500).json({ error: 'Failed to create client' });
  }

  await sendWhatsApp(buyer_phone, `onboard_${program}`, {
    name: buyer_name || 'there',
    templateParams: [
      buyer_name || 'there',
      program.replace(/_/g, ' ').toUpperCase(),
      `https://fitnessbymaddy.com/checkin?c=${client.id}&w=1`
    ]
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
      console.error('Week 1 program generation failed:', e.message);
    }
  }

  return res.status(200).json({ success: true, client_id: client.id });
};
