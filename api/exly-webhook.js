const crypto = require('crypto');
const { supabase } = require('./_lib/supabase');
const { sendTemplate } = require('./_lib/whatsapp');
const { isHinglish, detectMarket } = require('./_lib/market');

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
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature || ''));
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const signature = req.headers['x-exly-signature'];
    if (process.env.EXLY_WEBHOOK_SECRET && !verifySignature(req.body, signature)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const {
      phone, name, email, checkout_id, product_name,
      amount, program,
    } = req.body;

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    const programKey = program || inferProgram(product_name);
    const durationDays = PROGRAM_DURATIONS[programKey] || 42;
    const now = new Date();
    const endsAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

    const { data: lead } = await supabase
      .from('leads')
      .select('id, market')
      .eq('phone', phone)
      .single();

    if (lead) {
      await supabase.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const folderPath = `clients/${checkout_id || phone.replace(/\+/g, '')}`;

    const { data: client } = await supabase.from('clients').upsert({
      lead_id: lead?.id || null,
      phone,
      name,
      email,
      program: programKey,
      program_started_at: now.toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: amount ? parseInt(amount, 10) : null,
      checkout_id,
      folder_url: folderPath,
      status: 'active',
    }, { onConflict: 'phone' }).select().single();

    const market = lead?.market || detectMarket(phone);
    const hinglish = isHinglish(market);

    const templateName = `onboard_${programKey}`;
    const params = hinglish
      ? [name || 'there', `Welcome to the family! 🎉 Tera ${programKey} program start ho gaya hai.`]
      : [name || 'there', `Welcome to the family! 🎉 Your ${programKey} program has started.`];

    await sendTemplate(phone, templateName, params);

    if (programKey === '12wk') {
      await fetch('https://fitnessbymaddy.com/api/generate-program', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: client.id, week_no: 1 }),
      }).catch(() => {});
    }

    return res.status(200).json({ ok: true, client_id: client.id });
  } catch (err) {
    console.error('exly-webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function inferProgram(productName) {
  if (!productName) return '6wk_gym';
  const lower = productName.toLowerCase();
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40')) return '40plus';
  if (lower.includes('12') || lower.includes('flagship')) return '12wk';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('trial') || lower.includes('zoom')) return 'zoom_trial';
  return '6wk_gym';
}
