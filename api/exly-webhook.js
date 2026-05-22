const crypto = require('crypto');
const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp, detectMarket, isHinglish } = require('./lib/whatsapp');

const PROGRAM_MAP = {
  'shred': '6wk_gym',
  '6-week': '6wk_gym',
  'burn': '6wk_gym',
  'home': '6wk_home',
  '12-week': '12wk',
  'custom': '12wk',
  'flagship': '12wk',
  'pcos': 'pcos',
  'warrior': 'pcos',
  '40+': '40plus',
  '40plus': '40plus',
  'strong': '40plus',
  'trial': 'zoom_trial',
  'zoom': 'zoom_trial'
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

function identifyProgram(productName) {
  if (!productName) return 'zoom_trial';
  const lower = productName.toLowerCase();
  for (const [keyword, program] of Object.entries(PROGRAM_MAP)) {
    if (lower.includes(keyword)) return program;
  }
  return 'zoom_trial';
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (secret) {
    const signature = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'];
    if (signature) {
      const expected = crypto.createHmac('sha256', secret)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (signature !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }
  }

  const db = getSupabase();
  const payload = req.body;

  const phone = payload.phone || payload.mobile || payload.customer_phone;
  const email = payload.email || payload.customer_email;
  const name = payload.name || payload.customer_name;
  const amount = payload.amount || payload.paid_amount;
  const checkoutId = payload.checkout_id || payload.order_id || payload.transaction_id;
  const productName = payload.product_name || payload.item_name || '';

  if (!phone) {
    return res.status(400).json({ error: 'No phone in payload' });
  }

  try {
    const program = identifyProgram(productName);
    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const now = new Date();
    const endsAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

    let { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .limit(1);

    let leadId = lead?.[0]?.id;

    if (!leadId) {
      const { data: newLead } = await db.from('leads').insert({
        phone,
        name,
        source: 'exly_purchase',
        status: 'converted',
        market: detectMarket(phone)
      }).select().single();
      leadId = newLead.id;
    } else {
      await db.from('leads')
        .update({ status: 'converted' })
        .eq('id', leadId);
    }

    const { data: client } = await db.from('clients').insert({
      lead_id: leadId,
      phone,
      name,
      email,
      program,
      program_started_at: now.toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: parseInt(amount) || 0,
      checkout_id: checkoutId,
      folder_url: `/clients/${leadId}/`,
      status: 'active'
    }).select().single();

    const market = detectMarket(phone);
    const hinglish = isHinglish(market);

    const welcomeMsg = hinglish
      ? `Welcome to the family! 🎉 Teri ${productName || program} journey shuru ho gayi hai.\n\nEk week baad tera first check-in form aayega — progress track karne ke liye. Let's crush it! 💪`
      : `Welcome to the family! 🎉 Your ${productName || program} journey starts now.\n\nYou'll receive your first check-in form in one week to track your progress. Let's crush it! 💪`;

    await sendWhatsApp({
      phone,
      templateName: `onboard_${program}`,
      body: welcomeMsg,
      params: [name || 'Champion']
    });

    if (program === '12wk') {
      try {
        const generateUrl = `${process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : ''}/api/generate-program`;
        await fetch(generateUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`
          },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (genErr) {
        console.error('Week-1 generation trigger failed:', genErr.message);
      }
    }

    return res.status(200).json({ success: true, clientId: client.id });

  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
