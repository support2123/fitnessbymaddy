const crypto = require('crypto');
const { getSupabase } = require('../lib/supabase');
const { sendTemplate, notifyMaddy } = require('../lib/whatsapp');

const PROGRAM_MAP = {
  '6_week_shred': '6wk_gym',
  '6_week_home': '6wk_home',
  '12_week_custom': '12wk',
  'pcos_warrior': 'pcos',
  '40_plus': '40plus',
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
  return crypto.timingSafeEqual(Buffer.from(signature || ''), Buffer.from(expected));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const sig = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'];
  if (process.env.EXLY_WEBHOOK_SECRET && !verifySignature(req.body, sig)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const { customer_phone, customer_name, customer_email, product_id, amount, checkout_id } = req.body;

  if (!customer_phone) {
    return res.status(400).json({ error: 'customer_phone required' });
  }

  const db = getSupabase();
  const phone = customer_phone.replace(/^\+/, '');
  const program = PROGRAM_MAP[product_id] || '12wk';
  const durationDays = PROGRAM_DURATIONS[program] || 42;
  const now = new Date();
  const endsAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

  // Find lead
  const { data: lead } = await db
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .single();

  if (lead) {
    await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
  }

  // Create client
  const { data: client, error: clientErr } = await db.from('clients').upsert({
    lead_id: lead?.id || null,
    phone,
    name: customer_name || lead?.name || null,
    email: customer_email || null,
    program,
    program_started_at: now.toISOString(),
    program_ends_at: endsAt.toISOString(),
    paid_amount: parseInt(amount) || 0,
    checkout_id: checkout_id || null,
    folder_url: null,
    status: 'active'
  }, { onConflict: 'phone' }).select().single();

  if (clientErr) {
    console.error('Client creation error:', clientErr);
    return res.status(500).json({ error: 'Failed to create client' });
  }

  // Create storage folder
  const folderPath = `clients/${client.id}/.keep`;
  await db.storage.from('clients').upload(folderPath, '', { upsert: true });
  await db.from('clients').update({
    folder_url: `clients/${client.id}/`
  }).eq('id', client.id);

  // Send welcome message
  await sendTemplate(phone, `onboard_${program}`, [customer_name || 'there']);

  // Schedule first check-in (Day 7) by creating a pending checkin record
  await db.from('checkins').insert({
    client_id: client.id,
    week_no: 1,
    sent_at: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()
  });

  // For 12-week program, trigger immediate Week 1 generation
  if (program === '12wk') {
    const baseUrl = `https://${req.headers.host}`;
    fetch(`${baseUrl}/api/generate-program`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`
      },
      body: JSON.stringify({ client_id: client.id, week_no: 1 })
    }).catch(() => {});
  }

  return res.status(200).json({ success: true, client_id: client.id });
};
