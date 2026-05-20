const crypto = require('crypto');
const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { detectMarket } = require('./_lib/market');

const PROGRAM_MAP = {
  '6_week_shred_gym': '6wk_gym',
  '6_week_shred_home': '6wk_home',
  '6wk_gym': '6wk_gym',
  '6wk_home': '6wk_home',
  '12_week_custom': '12wk',
  '12wk': '12wk',
  'pcos_warrior': 'pcos',
  'pcos': 'pcos',
  '40_plus': '40plus',
  '40plus': '40plus',
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
  'zoom_pack': 28
};

function verifyWebhook(req) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true;
  const sig = req.headers['x-webhook-signature'] || req.headers['x-exly-signature'] || '';
  const body = JSON.stringify(req.body);
  const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  if (!verifyWebhook(req)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const db = getSupabase();
  const {
    phone, email, name, amount, checkout_id,
    product_name, product_id, status: paymentStatus
  } = req.body;

  if (!phone) return res.status(400).json({ error: 'phone required' });
  if (paymentStatus && paymentStatus !== 'success' && paymentStatus !== 'completed') {
    return res.status(200).json({ action: 'payment_not_completed' });
  }

  const programKey = PROGRAM_MAP[product_id] || PROGRAM_MAP[product_name] || '6wk_gym';
  const durationDays = PROGRAM_DURATIONS[programKey] || 42;

  const now = new Date();
  const endsAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

  const { data: lead } = await db
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .limit(1);

  const leadId = lead && lead.length > 0 ? lead[0].id : null;

  if (leadId) {
    await db.from('leads').update({ status: 'converted' }).eq('id', leadId);
  }

  const { data: existingClient } = await db
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .limit(1);

  let clientId;
  if (existingClient && existingClient.length > 0) {
    clientId = existingClient[0].id;
    await db.from('clients').update({
      name, email, program: programKey,
      program_started_at: now.toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: amount, checkout_id, status: 'active'
    }).eq('id', clientId);
  } else {
    const { data: newClient } = await db.from('clients').insert({
      lead_id: leadId, phone, name, email,
      program: programKey,
      program_started_at: now.toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: amount, checkout_id,
      folder_url: `/clients/${phone}`,
      status: 'active'
    }).select('id');
    clientId = newClient[0].id;
  }

  const market = detectMarket(phone);
  const isHinglish = market === 'IN';

  const onboardMsg = isHinglish
    ? `Welcome to the team! 🎉 Tumhara ${programKey.replace(/_/g, ' ')} program shuru ho raha hai.\n\nPehla check-in Day 7 pe aayega. Tayyar raho! 💪`
    : `Welcome to the team! 🎉 Your ${programKey.replace(/_/g, ' ')} program starts now.\n\nYour first check-in will be on Day 7. Let's go! 💪`;

  await sendWhatsApp({
    phone,
    templateName: `onboard_${programKey}`,
    body: onboardMsg,
    params: [name || 'Champion']
  });

  if (programKey === '12wk') {
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'https://www.fitnessbymaddy.com';

    try {
      await fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`
        },
        body: JSON.stringify({ client_id: clientId, week_no: 1 })
      });
    } catch (e) {
      console.error('Week 1 program generation failed:', e.message);
    }
  }

  return res.status(200).json({ success: true, client_id: clientId, program: programKey });
};
