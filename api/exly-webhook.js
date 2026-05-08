const crypto = require('crypto');
const { getSupabase } = require('./lib/supabase');
const { sendTemplate, detectMarket, isHinglish } = require('./lib/whatsapp');
const { logMessage } = require('./lib/rate-limit');

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
  if (!process.env.EXLY_WEBHOOK_SECRET) return true;
  const expected = crypto
    .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
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

  const signature = req.headers['x-exly-signature'] || '';
  if (process.env.EXLY_WEBHOOK_SECRET && !verifySignature(req.body, signature)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const {
    phone, email, name, amount, checkout_id,
    product_name, product_id,
  } = req.body || {};

  if (!phone) return res.status(400).json({ error: 'phone required' });

  const db = getSupabase();

  const program = product_id || inferProgram(product_name);
  const durationDays = PROGRAM_DURATIONS[program] || 42;
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

  const { error } = await db.from('clients').insert({
    id: clientId,
    lead_id: lead?.id || null,
    phone,
    name: name || null,
    email: email || null,
    program,
    program_started_at: now.toISOString(),
    program_ends_at: endsAt.toISOString(),
    paid_amount: amount || 0,
    checkout_id: checkout_id || null,
    folder_url: folderPath,
    status: 'active',
  });

  if (error) {
    console.error('Client insert error:', error.message);
    return res.status(500).json({ error: 'Failed to create client' });
  }

  const market = detectMarket(phone);
  const templateName = isHinglish(market)
    ? `onboard_${program}_hi`
    : `onboard_${program}`;

  await sendTemplate(phone, templateName, [name || 'there']);
  await logMessage(phone, 'out', `Onboarding for ${program}`, templateName);

  if (program === '12wk') {
    try {
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'https://fitnessbymaddy.com';
      await fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, week_no: 1 }),
      });
    } catch (e) {
      console.error('Program generation trigger failed:', e.message);
    }
  }

  return res.status(200).json({ success: true, client_id: clientId });
};

function inferProgram(productName) {
  const lower = (productName || '').toLowerCase();
  if (lower.includes('12') || lower.includes('custom')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40')) return '40plus';
  if (lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('zoom pack')) return 'zoom_pack';
  if (lower.includes('home')) return '6wk_home';
  return '6wk_gym';
}
