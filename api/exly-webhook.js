const crypto = require('crypto');
const { getSupabase } = require('./lib/supabase');
const { sendTemplate } = require('./lib/whatsapp');
const { maskPhone, weeksBetween } = require('./lib/utils');

const PROGRAM_DURATION = {
  '6wk_gym': 42, '6wk_home': 42, '12wk': 84,
  'pcos': 42, '40plus': 42, 'zoom_trial': 7, 'zoom_pack': 30
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const secret = process.env.EXLY_WEBHOOK_SECRET;
    if (secret) {
      const signature = req.headers['x-exly-signature'] || '';
      const rawBody = JSON.stringify(req.body);
      const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
      if (signature && signature !== expected) {
        return res.status(403).json({ error: 'Invalid signature' });
      }
    }

    const { phone, email, name, amount, checkout_id, product_name } = req.body;

    if (!phone || !checkout_id) {
      return res.status(400).json({ error: 'phone and checkout_id required' });
    }

    const db = getSupabase();

    const { data: lead } = await db.from('leads').select('*').eq('phone', phone).single();

    const program = mapProductToProgram(product_name, lead?.program_interest);
    const durationDays = PROGRAM_DURATION[program] || 42;
    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + durationDays * 24 * 60 * 60 * 1000);

    const { data: client, error } = await db.from('clients').insert({
      lead_id: lead?.id || null,
      phone,
      name: name || lead?.name,
      email,
      program,
      program_started_at: startDate.toISOString(),
      program_ends_at: endDate.toISOString(),
      paid_amount: amount,
      checkout_id,
      folder_url: null,
      status: 'active'
    }).select().single();

    if (error) {
      console.error('[exly-webhook] Insert error:', error.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const folderPath = `clients/${client.id}`;
    await db.storage.from('clients').upload(`${folderPath}/.keep`, new Blob(['']));
    await db.from('clients').update({ folder_url: folderPath }).eq('id', client.id);

    await sendTemplate(phone, `onboard_${program}`, [name || 'there']);

    if (program === '12wk') {
      const baseUrl = process.env.VERCEL_URL || 'www.fitnessbymaddy.com';
      await fetch(`https://${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`
        },
        body: JSON.stringify({ client_id: client.id, week_no: 1 })
      });
    }

    console.log(`[conversion] ${maskPhone(phone)} → ${program} ($${amount})`);
    return res.status(200).json({ ok: true, client_id: client.id });
  } catch (err) {
    console.error('[exly-webhook] Error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function mapProductToProgram(productName, leadInterest) {
  if (!productName) return leadInterest || '6wk_gym';
  const lower = productName.toLowerCase();
  if (lower.includes('12') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40') || lower.includes('strong')) return '40plus';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('trial') || lower.includes('zoom')) return 'zoom_trial';
  if (lower.includes('shred') || lower.includes('burn') || lower.includes('6')) return '6wk_gym';
  return leadInterest || '6wk_gym';
}
