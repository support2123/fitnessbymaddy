const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { detectMarket, isHinglish } = require('./_lib/market');
const { escalateToMaddy } = require('./_lib/escalation');
const crypto = require('crypto');

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build',
  '6wk_home': '6-Week Home Program',
  pcos: 'PCOS Warrior',
  '40plus': '40+ Strong',
  '12wk': '12-Week Flagship',
  zoom_trial: 'Zoom Trial',
  zoom_pack: 'Zoom Pack',
};

const PROGRAM_WEEKS = {
  '6wk_gym': 6, '6wk_home': 6, pcos: 6, '40plus': 6,
  '12wk': 12, zoom_trial: 1, zoom_pack: 4,
};

function mapExlyProduct(productName, fallback) {
  if (!productName) return fallback || 'zoom_trial';
  const lower = productName.toLowerCase();
  if (lower.includes('burn') || lower.includes('6 week') || lower.includes('shred')) return '6wk_gym';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40')) return '40plus';
  if (lower.includes('12') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('trial') || lower.includes('zoom')) return 'zoom_trial';
  return fallback || 'zoom_trial';
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (secret) {
    const sig = req.headers['x-exly-signature'] || '';
    const expected = crypto.createHmac('sha256', secret)
      .update(JSON.stringify(req.body)).digest('hex');
    if (sig !== expected) return res.status(401).json({ error: 'Invalid signature' });
  }

  const db = getSupabase();
  const { phone, email, name, amount, checkout_id, product_name } = req.body;

  if (!phone) return res.status(400).json({ error: 'phone required' });

  const { data: lead } = await db
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .limit(1)
    .single();

  if (!lead) {
    await escalateToMaddy({
      reason: 'Payment received but no lead found',
      phone,
      message: `Product: ${product_name}, Amount: ${amount}`,
      clientName: name,
    });
    return res.status(404).json({ error: 'Lead not found' });
  }

  const program = mapExlyProduct(product_name, lead.program_interest);
  const weeks = PROGRAM_WEEKS[program] || 6;
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + weeks * 7);

  const { data: client, error } = await db.from('clients').insert({
    lead_id: lead.id,
    phone,
    name: name || lead.name,
    email,
    program,
    program_started_at: new Date().toISOString(),
    program_ends_at: endDate.toISOString(),
    paid_amount: amount ? parseInt(amount) : null,
    checkout_id,
    status: 'active',
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });

  await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);

  await db.storage.from('clients').upload(
    `${client.id}/.keep`,
    new Uint8Array(0),
    { contentType: 'application/octet-stream' }
  );

  const market = detectMarket(phone);
  const hinglish = isHinglish(market);
  const progLabel = PROGRAM_NAMES[program] || program;

  const onboardBody = hinglish
    ? `Welcome to the family! \u{1F389}\u{1F525}\n\nTera ${progLabel} program start ho gaya hai. Pehla check-in Day 7 pe aayega.\n\nIntake form fill kiya? Nahi toh yahan se karo: https://fitnessbymaddy.com/intake.html?lead=${lead.id}\n\nLet's crush it! \u{1F4AA}`
    : `Welcome to the family! \u{1F389}\u{1F525}\n\nYour ${progLabel} program has officially started. Your first check-in will be on Day 7.\n\nHaven't filled the intake form yet? Do it here: https://fitnessbymaddy.com/intake.html?lead=${lead.id}\n\nLet's crush it! \u{1F4AA}`;

  await sendWhatsApp({
    phone,
    templateName: `onboard_${program}`,
    body: onboardBody,
  });

  if (program === '12wk') {
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'https://fitnessbymaddy.com';
    fetch(`${baseUrl}/api/generate-program`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: client.id, week_no: 1 }),
    }).catch(() => {});
  }

  res.json({ ok: true, clientId: client.id });
};
