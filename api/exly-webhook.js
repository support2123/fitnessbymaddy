const crypto = require('crypto');
const { getSupabase } = require('./lib/supabase');
const { sendTemplate } = require('./lib/whatsapp');

const PROGRAM_DURATIONS = {
  '6wk_gym': 42, '6wk_home': 42, '12wk': 84,
  'pcos': 42, '40plus': 42, 'zoom_trial': 7, 'zoom_pack': 30
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const signature = req.headers['x-exly-signature'] || '';
    if (process.env.EXLY_WEBHOOK_SECRET && signature) {
      const expected = crypto
        .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (signature !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const { buyer_phone, buyer_name, buyer_email, product_id, checkout_id, amount } = req.body;

    if (!buyer_phone) return res.status(400).json({ error: 'Missing buyer_phone' });

    const db = getSupabase();
    const phone = normalizePhone(buyer_phone);

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .limit(1)
      .single();

    const program = mapProductToProgram(product_id) || (lead && lead.program_interest) || '6wk_gym';
    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const endsAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString();

    const folderPath = `clients/${crypto.randomUUID()}`;

    const { data: client, error } = await db.from('clients').insert({
      lead_id: lead ? lead.id : null,
      phone,
      name: buyer_name || (lead && lead.name) || null,
      email: buyer_email || null,
      program,
      program_started_at: new Date().toISOString(),
      program_ends_at: endsAt,
      paid_amount: amount ? parseInt(amount, 10) : null,
      checkout_id: checkout_id || null,
      folder_url: folderPath,
      status: 'active'
    }).select().single();

    if (error) throw error;

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const templateName = `onboard_${program}`;
    await sendTemplate(phone, templateName, [buyer_name || 'there']);

    if (program === '12wk') {
      const origin = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'https://fitnessbymaddy.com';

      await fetch(`${origin}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: client.id, week_no: 1 })
      });
    }

    return res.json({ success: true, client_id: client.id });

  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function normalizePhone(phone) {
  let p = (phone || '').replace(/\s+/g, '').replace(/[^+\d]/g, '');
  if (p && !p.startsWith('+')) p = '+' + p;
  return p;
}

function mapProductToProgram(productId) {
  if (!productId) return null;
  const lower = (productId + '').toLowerCase();
  if (lower.includes('6wk') || lower.includes('shred') || lower.includes('burn')) return '6wk_gym';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40')) return '40plus';
  if (lower.includes('12wk') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('zoom') || lower.includes('pack')) return 'zoom_pack';
  return null;
}
