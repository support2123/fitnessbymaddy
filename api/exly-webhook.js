const crypto = require('crypto');
const { getSupabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');

const PROGRAM_DURATIONS = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 30,
};

function verifySignature(body, signature) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true;
  const expected = crypto.createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature || ''), Buffer.from(expected));
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const signature = req.headers['x-exly-signature'];
    if (process.env.EXLY_WEBHOOK_SECRET && !verifySignature(req.body, signature)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const { phone, name, email, amount, checkout_id, product_name } = req.body;

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    const db = getSupabase();

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    const program = lead?.program_interest || mapProductToProgram(product_name);
    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const endsAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString();

    const { data: client, error } = await db.from('clients').insert({
      lead_id: lead?.id || null,
      phone,
      name: name || lead?.name,
      email,
      program,
      paid_amount: amount ? parseInt(amount, 10) : null,
      checkout_id,
      program_ends_at: endsAt,
      folder_url: null,
    }).select().single();

    if (error) {
      console.error('Client creation error:', error.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const folderPath = `${client.id}/`;
    await db.storage.from('clients').upload(`${folderPath}.keep`, Buffer.from(''), { upsert: true });
    await db.from('clients').update({ folder_url: folderPath }).eq('id', client.id);

    await sendTemplate(phone, `onboard_${program}`, [name || 'there']);

    if (program === '12wk') {
      try {
        const baseUrl = `https://${req.headers.host}`;
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch (genErr) {
        console.error('Week-1 program generation failed:', genErr.message);
      }
    }

    return res.status(200).json({ success: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function mapProductToProgram(productName) {
  if (!productName) return '6wk_gym';
  const lower = productName.toLowerCase();
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40')) return '40plus';
  if (lower.includes('12')) return '12wk';
  if (lower.includes('zoom') && lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('zoom')) return 'zoom_pack';
  if (lower.includes('home')) return '6wk_home';
  return '6wk_gym';
}
