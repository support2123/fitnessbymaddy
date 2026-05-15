const crypto = require('crypto');
const { getSupabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { notifyMaddy } = require('../lib/escalation');

function verifySignature(body, signature) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true;
  const expected = crypto.createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature || ''), Buffer.from(expected));
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
    phone,
    email,
    name,
    amount,
    checkout_id,
    product_name,
    status,
  } = req.body;

  if (status === 'failed') {
    await notifyMaddy('Payment failure', { phone, info: `Payment failed for ${name}` });
    return res.status(200).json({ action: 'payment_failed_escalated' });
  }

  if (status !== 'success' && status !== 'completed') {
    return res.status(200).json({ action: 'ignored', reason: 'not a successful payment' });
  }

  const programSlug = detectProgram(product_name, amount);

  const { data: lead } = await db
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .single();

  const leadId = lead ? lead.id : null;

  if (lead) {
    await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
  }

  const programStart = new Date();
  const weeksDuration = programSlug === '12wk' ? 12 : 6;
  const programEnd = new Date(programStart.getTime() + weeksDuration * 7 * 24 * 60 * 60 * 1000);

  const { data: client, error: clientErr } = await db.from('clients').insert({
    lead_id: leadId,
    phone,
    name: name || (lead && lead.name) || '',
    email: email || '',
    program: programSlug,
    program_started_at: programStart.toISOString(),
    program_ends_at: programEnd.toISOString(),
    paid_amount: amount,
    checkout_id: checkout_id || null,
    folder_url: null,
    status: 'active',
  }).select().single();

  if (clientErr) return res.status(500).json({ error: 'Failed to create client' });

  const folderPath = `clients/${client.id}`;
  await db.storage.from('programs').upload(`${folderPath}/.keep`, new Uint8Array(0), {
    contentType: 'application/octet-stream',
    upsert: true,
  });
  await db.from('clients').update({ folder_url: folderPath }).eq('id', client.id);

  await sendTemplate(phone, `onboard_${programSlug}`, [
    name || 'there',
    String(weeksDuration),
  ]);

  if (programSlug === '12wk') {
    const origin = req.headers['x-forwarded-proto']
      ? `${req.headers['x-forwarded-proto']}://${req.headers['x-forwarded-host'] || req.headers.host}`
      : `https://${req.headers.host}`;

    await fetch(`${origin}/api/generate-program`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: client.id, week_no: 1 }),
    });
  }

  return res.status(200).json({ action: 'client_created', client_id: client.id });
};

function detectProgram(productName, amount) {
  const lower = (productName || '').toLowerCase();
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40+') || lower.includes('40 plus')) return '40plus';
  if (lower.includes('12') || lower.includes('flagship')) return '12wk';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('zoom') || lower.includes('trial')) return 'zoom_trial';
  if (amount >= 15000 || amount >= 180) return '12wk';
  if (amount <= 2500 || amount <= 25) return 'zoom_trial';
  return '6wk_gym';
}
