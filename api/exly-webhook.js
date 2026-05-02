const crypto = require('crypto');
const { getSupabase } = require('./lib/supabase');
const { sendTemplate } = require('./lib/whatsapp');

const PROGRAM_MAP = {
  '6wk_gym': { weeks: 6, label: '6-Week Burn & Build (Gym)' },
  '6wk_home': { weeks: 6, label: '6-Week Burn & Build (Home)' },
  '12wk': { weeks: 12, label: '12-Week Custom Program' },
  'pcos': { weeks: 8, label: 'PCOS Warrior' },
  '40plus': { weeks: 8, label: '40+ Strong' },
  'zoom_trial': { weeks: 1, label: 'Zoom Trial Session' },
  'zoom_pack': { weeks: 4, label: 'Zoom Pack (4 Sessions)' }
};

function verifySignature(payload, signature) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true;
  const computed = crypto.createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(signature || ''));
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const signature = req.headers['x-exly-signature'];
  if (process.env.EXLY_WEBHOOK_SECRET && !verifySignature(req.body, signature)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const db = getSupabase();
  const {
    customer_phone,
    customer_name,
    customer_email,
    product_id,
    checkout_id,
    amount
  } = req.body;

  if (!customer_phone || !product_id) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const phone = customer_phone.replace(/[^0-9+]/g, '');
  const program = product_id;
  const programInfo = PROGRAM_MAP[program];

  if (!programInfo) {
    return res.status(400).json({ error: 'Unknown program' });
  }

  const { data: lead } = await db
    .from('leads')
    .select('id')
    .eq('phone', phone)
    .single();

  if (lead) {
    await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
  }

  const programEnds = new Date();
  programEnds.setDate(programEnds.getDate() + programInfo.weeks * 7);

  const folderPath = `clients/${crypto.randomUUID()}`;

  const { data: client, error } = await db.from('clients').insert({
    lead_id: lead?.id || null,
    phone,
    name: customer_name,
    email: customer_email,
    program,
    program_started_at: new Date().toISOString(),
    program_ends_at: programEnds.toISOString(),
    paid_amount: amount ? parseInt(amount, 10) : null,
    checkout_id,
    folder_url: folderPath,
    status: 'active'
  }).select().single();

  if (error) {
    return res.status(500).json({ error: 'Failed to create client' });
  }

  await sendTemplate(phone, `onboard_${program}`, [
    customer_name || 'there',
    programInfo.label,
    `${programInfo.weeks} weeks`
  ]);

  if (program === '12wk') {
    try {
      const origin = `https://${req.headers.host}`;
      await fetch(`${origin}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: client.id, week_no: 1 })
      });
    } catch (e) {
      console.error('Week-1 program generation failed:', e.message);
    }
  }

  res.status(200).json({ success: true, client_id: client.id });
};
