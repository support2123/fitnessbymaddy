const { supabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { detectMarket, isHinglish } = require('./_lib/market');
const crypto = require('crypto');

const PROGRAM_MAP = {
  '6_week_shred': '6wk_gym',
  '6_week_home': '6wk_home',
  '12_week_custom': '12wk',
  'pcos_warrior': 'pcos',
  '40_plus': '40plus',
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
  if (!process.env.EXLY_WEBHOOK_SECRET) return true;
  const expected = crypto
    .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
    .update(JSON.stringify(body))
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature || ''), Buffer.from(expected));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const sig = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'] || '';
    if (process.env.EXLY_WEBHOOK_SECRET && !verifySignature(req.body, sig)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const { phone, name, email, product, amount, checkout_id, order_id } = req.body;

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    const program = PROGRAM_MAP[product] || product || '6wk_gym';
    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const now = new Date();
    const endsAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

    const { data: lead } = await supabase
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .single();

    if (lead) {
      await supabase.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const { data: newClient, error: clientError } = await supabase.from('clients').insert({
      lead_id: lead?.id || null,
      phone,
      name: name || null,
      email: email || null,
      program,
      program_started_at: now.toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: amount ? parseInt(amount) : null,
      checkout_id: checkout_id || order_id || null,
      folder_url: null,
      status: 'active'
    }).select().single();

    if (clientError) throw clientError;

    const folderPath = `clients/${newClient.id}/.keep`;
    await supabase.storage.from('programs').upload(folderPath, Buffer.from(''), {
      contentType: 'text/plain',
      upsert: true
    });

    const market = detectMarket(phone);
    const hinglish = isHinglish(market);
    const templateName = `onboard_${program}`;

    const welcomeMsg = hinglish
      ? [`Welcome to the family, ${name || 'champ'}! 🎉 Aapka ${program.replace(/_/g, ' ')} program shuru ho gaya hai. Day 7 ko pehla check-in form aayega. Let's crush it! 💪`]
      : [`Welcome to the family, ${name || 'champ'}! 🎉 Your ${program.replace(/_/g, ' ')} program starts now. Your first check-in form arrives on Day 7. Let's crush it! 💪`];

    await sendWhatsApp({
      phone,
      templateName,
      body: welcomeMsg,
      isClient: true
    });

    if (program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://fitnessbymaddy.com';
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: newClient.id, week_no: 1 })
        });
      } catch (e) {
        console.error('Week-1 program generation failed:', e.message);
      }
    }

    return res.status(200).json({ success: true, client_id: newClient.id });

  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
