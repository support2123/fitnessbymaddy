const crypto = require('crypto');
const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, isHinglish, detectMarket } = require('../lib/whatsapp');
const { getProgramWeeks, getProgramLabel, cors } = require('../lib/utils');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

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

  const {
    customer_phone, customer_name, customer_email,
    product_name, amount, checkout_id,
  } = req.body;

  if (!customer_phone) {
    return res.status(400).json({ error: 'Missing customer_phone' });
  }

  const db = getSupabase();

  const program = mapExlyProduct(product_name);
  const weeks = getProgramWeeks(program);
  const now = new Date();
  const endsAt = new Date(now.getTime() + weeks * 7 * 24 * 60 * 60 * 1000);

  const { data: lead } = await db
    .from('leads')
    .select('id')
    .eq('phone', customer_phone)
    .single();

  if (lead) {
    await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
  }

  const clientId = crypto.randomUUID();
  const folderPath = `clients/${clientId}`;

  await db.from('clients').insert({
    id: clientId,
    lead_id: lead ? lead.id : null,
    phone: customer_phone,
    name: customer_name || null,
    email: customer_email || null,
    program,
    program_started_at: now.toISOString(),
    program_ends_at: endsAt.toISOString(),
    paid_amount: Math.round((amount || 0) * 100),
    checkout_id: checkout_id || null,
    folder_url: folderPath,
    status: 'active',
  });

  const market = detectMarket(customer_phone);
  const hinglish = isHinglish(market);
  const label = getProgramLabel(program);

  const onboardParams = hinglish
    ? [customer_name || 'there', label, `https://www.fitnessbymaddy.com/checkin.html?c=${clientId}&w=1`]
    : [customer_name || 'there', label, `https://www.fitnessbymaddy.com/checkin.html?c=${clientId}&w=1`];

  await sendWhatsApp(customer_phone, `onboard_${program}`, onboardParams);

  if (program === '12wk') {
    try {
      await fetch(`https://www.fitnessbymaddy.com/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`,
        },
        body: JSON.stringify({ client_id: clientId, week_no: 1 }),
      });
    } catch (_) {}
  }

  return res.status(200).json({ success: true, client_id: clientId });
};

function mapExlyProduct(name) {
  if (!name) return '6wk_gym';
  const lower = name.toLowerCase();
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40+') || lower.includes('40 plus')) return '40plus';
  if (lower.includes('12') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('zoom') && lower.includes('pack')) return 'zoom_pack';
  return '6wk_gym';
}
