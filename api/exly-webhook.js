const crypto = require('crypto');
const { supabase } = require('../lib/supabase');
const { sendMessage } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');

const PROGRAM_DURATIONS = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 30,
};

const ONBOARD_MESSAGES = {
  '6wk_gym': {
    en: "Welcome to the 6-Week Burn & Build! 🔥 Your journey starts now. We'll send your first check-in form in 7 days.",
    hi: "6-Week Burn & Build mein welcome! 🔥 Tumhara journey ab shuru. 7 din mein pehla check-in form aayega.",
  },
  '6wk_home': {
    en: "Welcome to the 6-Week Home Program! 💪 No gym needed. Your first check-in comes in 7 days.",
    hi: "6-Week Home Program mein welcome! 💪 Gym ki zarurat nahi. 7 din mein pehla check-in aayega.",
  },
  '12wk': {
    en: "Welcome to the 12-Week Flagship Program! ⭐ Your personalized Week 1 plan is being generated right now. You'll receive it shortly!",
    hi: "12-Week Flagship Program mein welcome! ⭐ Tumhara Week 1 plan abhi ban raha hai. Jaldi milega!",
  },
  'pcos': {
    en: "Welcome to PCOS Warrior! 🌸 Designed specifically for hormonal balance and sustainable fitness. Check-in form in 7 days.",
    hi: "PCOS Warrior mein welcome! 🌸 Hormonal balance aur fitness ke liye design kiya gaya hai. 7 din mein check-in form aayega.",
  },
  '40plus': {
    en: "Welcome to 40+ Strong! 💎 Joint-friendly, science-backed training for lasting strength. First check-in in 7 days.",
    hi: "40+ Strong mein welcome! 💎 Joint-friendly aur science-backed training. 7 din mein pehla check-in aayega.",
  },
  'zoom_trial': {
    en: "Your Zoom Trial is confirmed! 📹 Maddy will personally reach out to schedule your session within 24 hours.",
    hi: "Zoom Trial confirm! 📹 Maddy 24 ghante mein session schedule karegi.",
  },
  'zoom_pack': {
    en: "Your Zoom Training Pack is activated! 📹 Maddy will reach out to schedule your first session.",
    hi: "Zoom Training Pack activated! 📹 Maddy pehla session schedule karegi.",
  },
};

function verifyWebhookSignature(payload, signature) {
  if (!process.env.EXLY_WEBHOOK_SECRET) return true;
  const expected = crypto
    .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
    .update(JSON.stringify(payload))
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature || ''), Buffer.from(expected));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const signature = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'];
    if (process.env.EXLY_WEBHOOK_SECRET && !verifyWebhookSignature(req.body, signature)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const {
      phone,
      name,
      email,
      program,
      amount,
      checkout_id,
      order_id,
    } = req.body;

    if (!phone || !program) {
      return res.status(400).json({ error: 'phone and program required' });
    }

    const cleanPhone = phone.replace(/[^0-9]/g, '');
    const market = detectMarket(cleanPhone);
    const duration = PROGRAM_DURATIONS[program] || 42;
    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + duration * 24 * 60 * 60 * 1000);

    // Find or create lead
    let { data: lead } = await supabase
      .from('leads')
      .select('id')
      .eq('phone', cleanPhone)
      .single();

    if (!lead) {
      const { data: newLead } = await supabase
        .from('leads')
        .insert({ phone: cleanPhone, name, market, status: 'converted' })
        .select('id')
        .single();
      lead = newLead;
    } else {
      await supabase.from('leads').update({ status: 'converted', name }).eq('id', lead.id);
    }

    // Create client
    const { data: client, error: clientErr } = await supabase
      .from('clients')
      .insert({
        lead_id: lead.id,
        phone: cleanPhone,
        name,
        email,
        program,
        program_started_at: startDate.toISOString(),
        program_ends_at: endDate.toISOString(),
        paid_amount: amount,
        checkout_id: checkout_id || order_id,
        folder_url: `clients/${lead.id}`,
        status: 'active',
      })
      .select()
      .single();

    if (clientErr) {
      console.error('Client creation error:', clientErr.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    // Create storage folder placeholder
    await supabase.storage
      .from('clients')
      .upload(`${client.id}/.keep`, Buffer.from(''), {
        contentType: 'text/plain',
        upsert: true,
      });

    // Send welcome message
    const lang = isHinglish(market) ? 'hi' : 'en';
    const onboardMsg = ONBOARD_MESSAGES[program]?.[lang] || ONBOARD_MESSAGES[program]?.en || 'Welcome! Your program is now active.';
    await sendMessage(cleanPhone, { template: `onboard_${program}`, text: onboardMsg, isClient: true });

    // For 12-week: trigger immediate program generation
    if (program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://fitnessbymaddy.com';

        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`,
          },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch (genErr) {
        console.error('Program generation trigger failed:', genErr.message);
      }
    }

    return res.status(200).json({ ok: true, client_id: client.id });
  } catch (err) {
    console.error('exly-webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
