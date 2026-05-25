const crypto = require('crypto');
const { getSupabase } = require('./lib/supabase');
const { sendTemplate } = require('./lib/whatsapp');

const PROGRAM_MAP = {
  '6_week_shred_gym': '6wk_gym',
  '6_week_shred_home': '6wk_home',
  '6_week_burn': '6wk_gym',
  '12_week_custom': '12wk',
  'pcos_warrior': 'pcos',
  '40_plus_strong': '40plus',
  'zoom_trial': 'zoom_trial',
  'zoom_pack': 'zoom_pack'
};

const PROGRAM_DURATIONS = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 30
};

function verifySignature(body, signature) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true;
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(typeof body === 'string' ? body : JSON.stringify(body));
  return hmac.digest('hex') === signature;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const signature = req.headers['x-exly-signature'] || '';
    if (!verifySignature(req.body, signature)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const { buyer_phone, buyer_name, buyer_email, product_id, amount, checkout_id } = req.body;

    if (!buyer_phone) {
      return res.status(400).json({ error: 'Missing buyer_phone' });
    }

    const db = getSupabase();
    const phone = buyer_phone.startsWith('+') ? buyer_phone : `+${buyer_phone}`;
    const program = PROGRAM_MAP[product_id] || '12wk';
    const durationDays = PROGRAM_DURATIONS[program] || 42;

    const now = new Date();
    const endsAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

    await db.from('leads').upsert({
      phone,
      name: buyer_name,
      status: 'converted',
      last_msg_at: now.toISOString()
    }, { onConflict: 'phone' });

    const { data: lead } = await db
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .single();

    const { data: client, error } = await db.from('clients').insert({
      lead_id: lead?.id,
      phone,
      name: buyer_name || 'New Client',
      email: buyer_email,
      program,
      program_started_at: now.toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: amount || 0,
      checkout_id,
      folder_url: `/clients/${lead?.id}/`,
      status: 'active'
    }).select().single();

    if (error) throw error;

    const templateName = `onboard_${program}`;
    await sendTemplate(phone, templateName, [buyer_name || 'there']);

    if (program === '12wk') {
      try {
        const origin = `https://${req.headers.host}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (e) {
        console.error('Week-1 program generation failed:', e.message);
      }
    }

    return res.status(200).json({ success: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
