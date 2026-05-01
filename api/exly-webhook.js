const { getSupabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { detectMarket } = require('../lib/market');
const crypto = require('crypto');

const PROGRAM_DURATION = {
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

  const db = getSupabase();

  try {
    const payload = req.body;
    const phone = payload.phone || payload.customer_phone || '';
    const email = payload.email || payload.customer_email || '';
    const name = payload.name || payload.customer_name || '';
    const amount = payload.amount || payload.paid_amount || 0;
    const checkoutId = payload.checkout_id || payload.order_id || '';
    const program = payload.program || payload.product_name || '';

    if (!phone) return res.status(400).json({ error: 'phone is required' });

    const programKey = mapProgramName(program);
    const durationDays = PROGRAM_DURATION[programKey] || 42;
    const now = new Date();
    const endsAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

    const { data: lead } = await db
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .single();

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const clientId = crypto.randomUUID();
    const folderPath = `clients/${clientId}`;

    const { data: client, error: clientErr } = await db
      .from('clients')
      .insert({
        id: clientId,
        lead_id: lead?.id || null,
        phone,
        name,
        email,
        program: programKey,
        program_started_at: now.toISOString(),
        program_ends_at: endsAt.toISOString(),
        paid_amount: Math.round(amount * 100),
        checkout_id: checkoutId,
        folder_url: folderPath,
        status: 'active',
      })
      .select()
      .single();

    if (clientErr) {
      console.error('Client insert error:', clientErr.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    try {
      await db.storage.from('clients').upload(
        `${clientId}/.keep`,
        new Uint8Array(0),
        { contentType: 'application/octet-stream' }
      );
    } catch (storageErr) {
      console.error('Storage folder creation:', storageErr.message);
    }

    await sendTemplate(phone, `onboard_${programKey}`, [name || 'there']);

    return res.status(200).json({
      ok: true,
      client_id: clientId,
      program: programKey,
      ends_at: endsAt.toISOString(),
    });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function mapProgramName(name) {
  const lower = (name || '').toLowerCase();
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40')) return '40plus';
  if (lower.includes('12') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('trial') || lower.includes('zoom trial')) return 'zoom_trial';
  if (lower.includes('zoom') || lower.includes('pack')) return 'zoom_pack';
  return '6wk_gym';
}
