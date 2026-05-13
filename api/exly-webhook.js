const crypto = require('crypto');
const { supabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');

const EXLY_PROGRAM_MAP = {
  'sixweek-gym': '6wk_gym',
  'sixweek-home': '6wk_home',
  'twelve-week-flagship': '12wk',
  'pcos-warrior': 'pcos',
  '40plus-strong': '40plus',
  'zoom-trial': 'zoom_trial',
  'zoom-pack': 'zoom_pack'
};

const PROGRAM_WEEKS = {
  '6wk_gym': 6, '6wk_home': 6, '12wk': 12,
  pcos: 6, '40plus': 8, zoom_trial: 1, zoom_pack: 4
};

function verifySignature(body, signature) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true; // skip verification if not configured
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(typeof body === 'string' ? body : JSON.stringify(body));
  return hmac.digest('hex') === signature;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const signature = req.headers['x-exly-signature'];
  if (!verifySignature(req.body, signature)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const { phone, name, email, checkout_id, product_slug, amount } = req.body;
  if (!phone || !product_slug) {
    return res.status(400).json({ error: 'phone and product_slug are required' });
  }

  const program = EXLY_PROGRAM_MAP[product_slug];
  if (!program) {
    return res.status(400).json({ error: `Unknown product: ${product_slug}` });
  }

  const { data: lead } = await supabase
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .single();

  if (lead) {
    await supabase.from('leads')
      .update({ status: 'converted' })
      .eq('id', lead.id);
  }

  const weeks = PROGRAM_WEEKS[program] || 6;
  const endsAt = new Date();
  endsAt.setDate(endsAt.getDate() + weeks * 7);

  const folderPath = `clients/${phone.replace('+', '')}`;

  const { data: client, error } = await supabase.from('clients').insert({
    lead_id: lead?.id || null,
    phone,
    name: name || lead?.name || null,
    email: email || null,
    program,
    program_started_at: new Date().toISOString(),
    program_ends_at: endsAt.toISOString(),
    paid_amount: amount || null,
    checkout_id: checkout_id || null,
    folder_url: folderPath,
    status: 'active'
  }).select().single();

  if (error) {
    console.error('Client creation error:', error);
    return res.status(500).json({ error: 'Failed to create client' });
  }

  const market = detectMarket(phone);
  const hinglish = isHinglish(market);
  const templateName = hinglish ? `onboard_${program}_hi` : `onboard_${program}`;
  await sendTemplate(phone, templateName, [name || 'there']);

  if (program === '12wk') {
    try {
      const origin = `https://${req.headers.host}`;
      await fetch(`${origin}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: client.id, week_no: 1 })
      });
    } catch (err) {
      console.error('Week-1 program generation failed:', err.message);
    }
  }

  return res.status(200).json({ ok: true, client_id: client.id, program });
};
