const crypto = require('crypto');
const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('../lib/market');
const { escalateToMaddy } = require('../lib/escalation');

const PROGRAM_DURATIONS = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 30
};

const ONBOARD_MESSAGES = {
  '12wk': {
    en: "Welcome to the 12-Week Custom Program! 🎉 Your personalised plan is being built. You'll receive your Week 1 program within 24 hours. Fill out your intake form if you haven't already.",
    hi: "12-Week Custom Program mein welcome! 🎉 Aapka personalised plan ban raha hai. Week 1 ka program 24 ghante mein milega. Agar intake form nahi bhara toh pehle bhar do."
  },
  '6wk_gym': {
    en: "Welcome to the 6-Week Burn & Build! 🔥 Your journey starts NOW. Check your email for the full program guide. Let's crush it!",
    hi: "6-Week Burn & Build mein welcome! 🔥 Journey ab shuru hoti hai. Email check karo full program guide ke liye. Let's go!"
  },
  '6wk_home': {
    en: "Welcome to the 6-Week Home Program! 💪 No gym needed. Your program is in your email. Let's do this!",
    hi: "6-Week Home Program mein welcome! 💪 Gym ki zaroorat nahi. Program email mein hai. Shuru karte hain!"
  },
  'pcos': {
    en: "Welcome to PCOS Warrior! 🌸 A program designed specifically for hormonal balance and sustainable fitness. Check your email for details.",
    hi: "PCOS Warrior mein welcome! 🌸 Hormonal balance aur sustainable fitness ke liye bana hai ye program. Email check karo details ke liye."
  },
  '40plus': {
    en: "Welcome to 40+ Strong! 💎 Fitness that respects your body. Your program details are in your email.",
    hi: "40+ Strong mein welcome! 💎 Aapki body ke according fitness. Program details email mein hain."
  },
  'zoom_trial': {
    en: "Welcome! 🎯 Your Zoom trial session will be scheduled within 48 hours. Keep an eye on WhatsApp for the link!",
    hi: "Welcome! 🎯 Zoom trial session 48 ghante mein schedule hoga. WhatsApp pe link aayega!"
  }
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const signature = req.headers['x-exly-signature'];
    if (process.env.EXLY_WEBHOOK_SECRET && signature) {
      const expected = crypto
        .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (signature !== expected) {
        return res.status(401).json({ error: 'invalid signature' });
      }
    }

    const {
      phone, name, email, amount, checkout_id,
      product_name, product_id
    } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone required' });

    const db = getSupabase();
    const normalizedPhone = normalizePhone(phone);
    const market = detectMarket(normalizedPhone);
    const hinglish = isHinglish(market);

    const program = mapProductToProgram(product_name || product_id || '');
    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const now = new Date();
    const endsAt = new Date(now.getTime() + durationDays * 86400000);

    // Find or create lead
    let { data: lead } = await db
      .from('leads')
      .select('id')
      .eq('phone', normalizedPhone)
      .single();

    if (!lead) {
      const { data: newLead } = await db
        .from('leads')
        .insert({
          phone: normalizedPhone, name, source: 'exly',
          status: 'converted', program_interest: program, market
        })
        .select('id')
        .single();
      lead = newLead;
    } else {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    // Create client record
    const folderPath = `clients/${lead.id}`;
    const { data: client } = await db
      .from('clients')
      .insert({
        lead_id: lead.id,
        phone: normalizedPhone,
        name: name || null,
        email: email || null,
        program,
        program_started_at: now.toISOString(),
        program_ends_at: endsAt.toISOString(),
        paid_amount: Math.round((amount || 0) * 100),
        checkout_id: checkout_id || null,
        folder_url: folderPath,
        status: 'active'
      })
      .select('id')
      .single();

    // Create storage folder
    await db.storage
      .from('client-files')
      .upload(`${folderPath}/.keep`, new Uint8Array(0), { upsert: true });

    // Send onboard message
    const msgs = ONBOARD_MESSAGES[program] || ONBOARD_MESSAGES['6wk_gym'];
    const body = hinglish ? msgs.hi : msgs.en;
    await sendWhatsApp({ phone: normalizedPhone, body, templateName: `onboard_${program}` });

    // For 12-week program, trigger immediate Week 1 generation
    if (program === '12wk' && client) {
      try {
        await fetch(`${process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : ''}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`
          },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (genErr) {
        console.error('Week 1 generation trigger failed:', genErr.message);
      }
    }

    console.log(`Conversion: ${maskPhone(normalizedPhone)} → ${program}`);
    return res.json({ success: true, client_id: client?.id, program });

  } catch (err) {
    console.error('exly-webhook error:', err.message);
    if (req.body?.phone) {
      await escalateToMaddy('payment_webhook_error', req.body.phone, err.message);
    }
    return res.status(500).json({ error: 'internal' });
  }
};

function mapProductToProgram(productStr) {
  const lower = (productStr || '').toLowerCase();
  if (lower.includes('12') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40') || lower.includes('strong')) return '40plus';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('trial') || lower.includes('zoom')) return 'zoom_trial';
  if (lower.includes('pack')) return 'zoom_pack';
  return '6wk_gym';
}

function normalizePhone(raw) {
  let p = raw.replace(/[^0-9+]/g, '');
  if (!p.startsWith('+')) p = '+' + p;
  return p;
}
