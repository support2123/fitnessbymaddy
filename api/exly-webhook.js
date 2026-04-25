const crypto = require('crypto');
const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');

const PROGRAM_DURATION = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 30,
};

const TEMPLATE_MAP = {
  '6wk_gym': 'onboard_6wk',
  '6wk_home': 'onboard_6wk',
  '12wk': 'onboard_12wk',
  'pcos': 'onboard_pcos',
  '40plus': 'onboard_40plus',
  'zoom_trial': 'onboard_zoom',
  'zoom_pack': 'onboard_zoom',
};

function verifySignature(body, signature) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true;
  const expected = crypto.createHmac('sha256', secret)
    .update(JSON.stringify(body))
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature || ''),
    Buffer.from(expected)
  );
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

  try {
    const sig = req.headers['x-exly-signature'] || '';
    if (process.env.EXLY_WEBHOOK_SECRET && !verifySignature(req.body, sig)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const {
      phone, name, email, checkout_id,
      product_name, amount, currency,
    } = req.body;

    if (!phone || !checkout_id) {
      return res.status(400).json({ error: 'phone and checkout_id required' });
    }

    const program = inferProgram(product_name);
    const durationDays = PROGRAM_DURATION[program] || 42;
    const now = new Date();
    const endsAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

    const { data: lead } = await db.from('leads')
      .select('id')
      .eq('phone', phone)
      .limit(1)
      .single();

    if (lead) {
      await db.from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const { data: client, error } = await db.from('clients').insert({
      lead_id: lead?.id || null,
      phone,
      name: name || '',
      email: email || '',
      program,
      program_started_at: now.toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: amount || 0,
      checkout_id,
      folder_url: `/clients/${checkout_id}/`,
      status: 'active',
    }).select().single();

    if (error) {
      if (error.code === '23505') {
        return res.json({ action: 'already_exists', phone });
      }
      throw error;
    }

    await db.storage.from('client-data')
      .upload(`clients/${client.id}/.keep`, '', {
        contentType: 'text/plain',
        upsert: true,
      });

    const template = TEMPLATE_MAP[program] || 'onboard_6wk';
    await sendWhatsApp(phone, template, [name || 'there', program]);

    return res.json({ action: 'converted', client_id: client.id, program });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function inferProgram(productName) {
  const lower = (productName || '').toLowerCase();
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40')) return '40plus';
  if (lower.includes('12') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('zoom') || lower.includes('pack')) return 'zoom_pack';
  if (lower.includes('home')) return '6wk_home';
  return '6wk_gym';
}
