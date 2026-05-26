const crypto = require('crypto');
const { getSupabase } = require('../lib/supabase');
const { sendTemplate, notifyMaddy } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/market');

function verifySignature(payload, signature) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true;
  const expected = crypto.createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature || ''), Buffer.from(expected));
}

const PROGRAM_DURATIONS = {
  '6wk_gym': 42, '6wk_home': 42,
  '12wk': 84, pcos: 42,
  '40plus': 42, zoom_trial: 7, zoom_pack: 30
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const signature = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'];
  if (process.env.EXLY_WEBHOOK_SECRET && !verifySignature(req.body, signature)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const db = getSupabase();
  const {
    customer_phone, customer_name, customer_email,
    product_name, amount, checkout_id, order_id
  } = req.body;

  const phone = customer_phone;
  if (!phone) return res.status(400).json({ error: 'No customer_phone' });

  let program = null;
  const pn = (product_name || '').toLowerCase();
  if (pn.includes('6') && pn.includes('burn')) program = '6wk_gym';
  else if (pn.includes('6') && pn.includes('home')) program = '6wk_home';
  else if (pn.includes('12') || pn.includes('flagship')) program = '12wk';
  else if (pn.includes('pcos')) program = 'pcos';
  else if (pn.includes('40')) program = '40plus';
  else if (pn.includes('trial')) program = 'zoom_trial';
  else if (pn.includes('zoom') && pn.includes('pack')) program = 'zoom_pack';

  const { data: lead } = await db.from('leads')
    .select('*')
    .eq('phone', phone)
    .single();

  if (lead) {
    await db.from('leads')
      .update({ status: 'converted', program_interest: program || lead.program_interest })
      .eq('id', lead.id);
  }

  const duration = PROGRAM_DURATIONS[program] || 42;
  const startDate = new Date();
  const endDate = new Date(startDate.getTime() + duration * 24 * 60 * 60 * 1000);

  const { data: client, error } = await db.from('clients').upsert({
    lead_id: lead ? lead.id : null,
    phone,
    name: customer_name || (lead ? lead.name : null),
    email: customer_email,
    program,
    program_started_at: startDate.toISOString(),
    program_ends_at: endDate.toISOString(),
    paid_amount: amount ? parseInt(amount, 10) : null,
    checkout_id: checkout_id || order_id,
    status: 'active'
  }, { onConflict: 'phone' }).select().single();

  if (error) {
    console.error('Client upsert error:', error);
    return res.status(500).json({ error: 'Failed to create client' });
  }

  const folderPath = `clients/${client.id}/`;
  await db.storage.from('clients').upload(
    `${client.id}/.keep`,
    new Uint8Array(0),
    { contentType: 'application/octet-stream', upsert: true }
  );

  await db.from('clients')
    .update({ folder_url: folderPath })
    .eq('id', client.id);

  const templateName = `onboard_${program || 'general'}`;
  await sendTemplate(phone, templateName, {
    name: customer_name || 'there',
    templateParams: [customer_name || 'there']
  });

  if (program === '12wk') {
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'https://fitnessbymaddy.com';

    fetch(`${baseUrl}/api/generate-program`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-key': process.env.SUPABASE_SERVICE_KEY
      },
      body: JSON.stringify({ client_id: client.id, week_no: 1 })
    }).catch(err => console.error('Week-1 program generation failed:', err.message));
  }

  return res.status(200).json({ ok: true, client_id: client.id, program });
};
