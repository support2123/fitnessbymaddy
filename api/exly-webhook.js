const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { escalateToMaddy } = require('./_lib/escalation');
const crypto = require('crypto');

const PROGRAM_DURATIONS = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 30,
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (process.env.EXLY_WEBHOOK_SECRET) {
    const sig = req.headers['x-exly-signature'] || '';
    const expected = crypto
      .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
      .update(JSON.stringify(req.body))
      .digest('hex');
    if (sig !== expected) {
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }

  const db = getSupabase();
  const {
    customer_phone, customer_name, customer_email,
    product_name, amount, checkout_id, status,
  } = req.body;

  if (status !== 'completed' && status !== 'success') {
    if (status === 'failed') {
      const { data: existingClient } = await db
        .from('clients')
        .select('id')
        .eq('phone', customer_phone)
        .eq('status', 'active')
        .limit(1);

      if (existingClient && existingClient.length > 0) {
        await escalateToMaddy('Payment failure for active client', customer_phone, `Amount: ${amount}`);
      }
    }
    return res.status(200).json({ ok: true, action: 'non_completed_status' });
  }

  const phone = customer_phone.startsWith('+') ? customer_phone : '+' + customer_phone;
  const program = detectProgram(product_name);
  const durationDays = PROGRAM_DURATIONS[program] || 42;
  const now = new Date();
  const endsAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

  const { data: lead } = await db
    .from('leads')
    .select('id')
    .eq('phone', phone)
    .limit(1)
    .single();

  if (lead) {
    await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
  }

  const { data: client } = await db.from('clients').insert({
    lead_id: lead?.id || null,
    phone,
    name: customer_name,
    email: customer_email,
    program,
    program_started_at: now.toISOString(),
    program_ends_at: endsAt.toISOString(),
    paid_amount: amount,
    checkout_id,
    folder_url: null,
    status: 'active',
  }).select().single();

  const folderPath = `clients/${client.id}`;
  await db.storage.from('client-files').upload(
    `${folderPath}/.keep`,
    new Uint8Array([0]),
    { contentType: 'application/octet-stream', upsert: true }
  );

  await db.from('clients').update({
    folder_url: folderPath,
  }).eq('id', client.id);

  await sendWhatsApp(phone, `onboard_${program}`, [
    customer_name || 'there',
    `${durationDays / 7} weeks`,
  ]);

  if (program === '12wk') {
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'https://www.fitnessbymaddy.com';

    await fetch(`${baseUrl}/api/generate-program`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.INTERNAL_API_KEY}`,
      },
      body: JSON.stringify({ client_id: client.id, week_no: 1 }),
    });
  }

  return res.status(200).json({ ok: true, client_id: client.id });
};

function detectProgram(productName) {
  const lower = (productName || '').toLowerCase();
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40+') || lower.includes('40 plus')) return '40plus';
  if (lower.includes('12') || lower.includes('flagship') || lower.includes('custom')) return '12wk';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('zoom') && lower.includes('pack')) return 'zoom_pack';
  return '6wk_gym';
}
