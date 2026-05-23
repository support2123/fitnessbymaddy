const crypto = require('crypto');
const { getSupabase } = require('./_lib/supabase');
const { sendWhatsAppUnlimited } = require('./_lib/whatsapp');
const { detectMarket, isHinglish } = require('./_lib/market');

const PROGRAM_DURATIONS = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 28
};

const ONBOARD_MESSAGES = {
  '6wk_gym': {
    en: "Welcome to the 6-Week Burn & Build program! Your workout plan and nutrition guide are being prepared. Check your email for next steps.",
    hi: "Welcome! 6-Week Burn & Build program mein aa gaye ho! Tumhara workout plan aur nutrition guide ready ho raha hai. Email check karo next steps ke liye."
  },
  '12wk': {
    en: "Welcome to Maddy's 12-Week Flagship Program! This is going to be an incredible journey. Your Week 1 plan will arrive within 24 hours.",
    hi: "Welcome! Maddy ke 12-Week Flagship Program mein aa gaye ho! Ye journey amazing hone wali hai. Week 1 ka plan 24 ghante mein aa jayega."
  },
  'pcos': {
    en: "Welcome to the PCOS Warrior program! Maddy has designed this specifically for hormonal balance and sustainable fat loss. Your plan is coming soon.",
    hi: "Welcome! PCOS Warrior program mein aa gaye ho! Maddy ne ye specially hormonal balance aur sustainable fat loss ke liye design kiya hai. Plan jaldi aayega."
  },
  '40plus': {
    en: "Welcome to 40+ Strong! This program is built for joint-friendly strength and vitality. Your plan is on its way.",
    hi: "Welcome! 40+ Strong program mein aa gaye ho! Ye program joint-friendly strength aur vitality ke liye bana hai. Plan aa raha hai."
  },
  'zoom_trial': {
    en: "Your Zoom trial session is booked! You'll receive a calendar invite shortly. Get ready for a great session with Maddy.",
    hi: "Tumhara Zoom trial session book ho gaya! Calendar invite jaldi aayega. Maddy ke saath amazing session hone wala hai."
  }
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (secret) {
    const sig = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'] || '';
    const expected = crypto.createHmac('sha256', secret).update(JSON.stringify(req.body)).digest('hex');
    if (sig && sig !== expected) {
      return res.status(401).json({ error: 'invalid signature' });
    }
  }

  try {
    const {
      phone, email, name, checkout_id,
      product_name, amount, status: paymentStatus
    } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone required' });
    if (paymentStatus && paymentStatus !== 'completed' && paymentStatus !== 'success') {
      return res.status(200).json({ action: 'payment_not_completed' });
    }

    const db = getSupabase();
    const program = detectProgram(product_name);
    const market = detectMarket(phone);
    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const programEnds = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString();

    const { data: lead } = await db
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .limit(1)
      .single();

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const { data: client, error: clientErr } = await db.from('clients').insert({
      lead_id: lead?.id || null,
      phone,
      name: name || null,
      email: email || null,
      program,
      program_started_at: new Date().toISOString(),
      program_ends_at: programEnds,
      paid_amount: amount ? parseInt(amount, 10) : 0,
      checkout_id: checkout_id || null,
      folder_url: null,
      status: 'active'
    }).select().single();

    if (clientErr) {
      console.error('Client insert error:', clientErr.message);
      return res.status(500).json({ error: 'client_creation_failed' });
    }

    const msgs = ONBOARD_MESSAGES[program] || ONBOARD_MESSAGES['6wk_gym'];
    const msg = isHinglish(market) ? msgs.hi : msgs.en;
    await sendWhatsAppUnlimited(phone, `onboard_${program}`, msg);

    return res.status(200).json({
      ok: true,
      client_id: client.id,
      program
    });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'internal' });
  }
};

function detectProgram(productName) {
  if (!productName) return '6wk_gym';
  const lower = productName.toLowerCase();
  if (lower.includes('12') || lower.includes('flagship') || lower.includes('custom')) return '12wk';
  if (lower.includes('pcos') || lower.includes('warrior')) return 'pcos';
  if (lower.includes('40') || lower.includes('strong')) return '40plus';
  if (lower.includes('trial') || lower.includes('zoom')) return 'zoom_trial';
  if (lower.includes('home')) return '6wk_home';
  return '6wk_gym';
}
