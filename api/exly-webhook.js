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
  'zoom_pack': 28
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const secret = process.env.EXLY_WEBHOOK_SECRET;
    if (secret) {
      const sig = req.headers['x-exly-signature'] || '';
      const expected = crypto
        .createHmac('sha256', secret)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (sig && sig !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const { phone, email, name, product, amount, checkout_id } = req.body;
    if (!phone) return res.status(400).json({ error: 'Phone required' });

    const db = getSupabase();

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    const leadId = lead?.id || null;

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const program = mapProductToProgram(product);
    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const endsAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString();

    const { data: client, error } = await db.from('clients').insert({
      lead_id: leadId,
      phone,
      name: name || lead?.name,
      email,
      program,
      program_started_at: new Date().toISOString(),
      program_ends_at: endsAt,
      paid_amount: parseInt(amount) || 0,
      checkout_id: checkout_id || null,
      folder_url: null,
      status: 'active'
    }).select().single();

    if (error) throw error;

    const folderPath = `clients/${client.id}`;
    await db.storage.from('client-data').upload(
      `${folderPath}/.keep`,
      'initialized',
      { contentType: 'text/plain', upsert: true }
    );

    await db.from('clients').update({
      folder_url: folderPath
    }).eq('id', client.id);

    const templateName = `onboard_${program}`;
    await sendTemplate(phone, templateName, [name || 'there']);

    return res.status(200).json({
      success: true,
      client_id: client.id,
      program,
      ends_at: endsAt
    });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function mapProductToProgram(product) {
  if (!product) return '6wk_gym';
  const lower = product.toLowerCase();
  if (lower.includes('12') || lower.includes('flagship') || lower.includes('custom')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40') || lower.includes('strong')) return '40plus';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('zoom') && lower.includes('pack')) return 'zoom_pack';
  if (lower.includes('zoom') || lower.includes('trial')) return 'zoom_trial';
  return '6wk_gym';
}
