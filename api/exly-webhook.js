const crypto = require('crypto');
const { getSupabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  if (process.env.EXLY_WEBHOOK_SECRET) {
    const sig = req.headers['x-exly-signature'];
    const expected = crypto
      .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
      .update(JSON.stringify(req.body))
      .digest('hex');
    if (sig !== expected) {
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }

  const db = getSupabase();
  const { customer_phone, customer_name, customer_email, product_name, amount, checkout_id } = req.body;

  if (!customer_phone) return res.status(400).json({ error: 'Missing phone' });

  try {
    const phone = customer_phone.replace(/[^0-9]/g, '');
    const program = mapProductToProgram(product_name);

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const programDuration = getProgramDuration(program);
    const startsAt = new Date();
    const endsAt = new Date(startsAt.getTime() + programDuration * 7 * 24 * 60 * 60 * 1000);

    const { data: client, error } = await db.from('clients').insert({
      lead_id: lead?.id || null,
      phone,
      name: customer_name || lead?.name || null,
      email: customer_email || null,
      program,
      program_started_at: startsAt.toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: amount ? Math.round(amount * 100) : null,
      checkout_id: checkout_id || null,
      folder_url: null,
      status: 'active',
    }).select().single();

    if (error) throw error;

    const folderPath = `clients/${client.id}`;
    await db.storage.from('clients').upload(`${client.id}/.keep`, new Uint8Array(0), {
      contentType: 'text/plain',
      upsert: true,
    });

    await db.from('clients').update({ folder_url: folderPath }).eq('id', client.id);

    const templateName = `onboard_${program}`;
    await sendTemplate(phone, templateName, [customer_name || 'there']);

    if (program === '12wk') {
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'https://fitnessbymaddy.com';
      await fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`,
        },
        body: JSON.stringify({ client_id: client.id, week_no: 1 }),
      });
    }

    return res.json({ ok: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Failed to process purchase' });
  }
};

function mapProductToProgram(productName) {
  if (!productName) return '6wk_gym';
  const lower = productName.toLowerCase();
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40+') || lower.includes('40 plus')) return '40plus';
  if (lower.includes('12') || lower.includes('flagship') || lower.includes('custom')) return '12wk';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('zoom') && lower.includes('pack')) return 'zoom_pack';
  if (lower.includes('zoom') || lower.includes('trial')) return 'zoom_trial';
  return '6wk_gym';
}

function getProgramDuration(program) {
  const durations = {
    '6wk_gym': 6, '6wk_home': 6, '12wk': 12,
    'pcos': 6, '40plus': 6, 'zoom_trial': 1, 'zoom_pack': 4,
  };
  return durations[program] || 6;
}
