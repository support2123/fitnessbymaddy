const crypto = require('crypto');
const { getClient } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { cors, parseBody, maskPhone, weeksBetween } = require('../lib/helpers');

function verifyExlySignature(body, signature) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true; // skip verification if secret not configured
  const hash = crypto.createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex');
  return hash === signature;
}

const PROGRAM_DURATIONS = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 30,
};

function mapExlyProduct(productName) {
  const lower = (productName || '').toLowerCase();
  if (lower.includes('12') && lower.includes('week')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40')) return '40plus';
  if (lower.includes('zoom') && lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('zoom')) return 'zoom_pack';
  if (lower.includes('home')) return '6wk_home';
  return '6wk_gym';
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const body = await parseBody(req);
  const signature = req.headers['x-exly-signature'] || '';

  if (!verifyExlySignature(body, signature)) {
    console.error('[EXLY] Invalid signature');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const phone = body.phone || body.customer_phone;
  const email = body.email || body.customer_email;
  const name = body.name || body.customer_name;
  const amount = body.amount || body.paid_amount || 0;
  const checkoutId = body.checkout_id || body.order_id || '';
  const productName = body.product_name || body.product || '';

  if (!phone) {
    return res.status(400).json({ error: 'Missing phone' });
  }

  const db = getClient();
  const program = mapExlyProduct(productName);
  const durationDays = PROGRAM_DURATIONS[program] || 42;
  const now = new Date();
  const endsAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

  console.log(`[EXLY] Purchase: ${maskPhone(phone)} → ${program} ($${amount})`);

  // Find or create lead
  let { data: lead } = await db
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .single();

  if (!lead) {
    const { data: newLead } = await db
      .from('leads')
      .insert({ phone, name, source: 'exly', status: 'converted' })
      .select()
      .single();
    lead = newLead;
  } else {
    await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
  }

  // Create client record
  const { data: client, error } = await db
    .from('clients')
    .insert({
      lead_id: lead.id,
      phone,
      name: name || lead.name,
      email,
      program,
      program_started_at: now.toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: parseInt(amount, 10),
      checkout_id: checkoutId,
      folder_url: `/clients/${lead.id}/`,
      status: 'active',
    })
    .select()
    .single();

  if (error) {
    console.error('[EXLY-CLIENT]', error.message);
    return res.status(500).json({ error: 'Failed to create client' });
  }

  // Create storage folder
  try {
    await db.storage
      .from('clients')
      .upload(`${client.id}/.keep`, new Uint8Array(0), {
        contentType: 'application/octet-stream',
        upsert: true,
      });
  } catch (storageErr) {
    console.error('[STORAGE]', storageErr.message);
  }

  // Send onboarding WhatsApp
  await sendTemplate(phone, `onboard_${program}`, [
    name || 'there',
    `https://fitnessbymaddy.com/intake?lead=${lead.id}`,
  ]);

  // For 12-week clients, generate Week 1 program immediately
  if (program === '12wk') {
    try {
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'https://fitnessbymaddy.com';

      await fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: client.id, week_no: 1 }),
      });
    } catch (err) {
      console.error('[PROGRAM-GEN]', err.message);
    }
  }

  return res.status(200).json({
    success: true,
    client_id: client.id,
    program,
  });
};
