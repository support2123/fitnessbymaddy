const { getClient } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');
const { escalateToMaddy } = require('../lib/escalation');
const crypto = require('crypto');

const PROGRAM_DURATIONS = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 30
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getClient();

  try {
    if (process.env.EXLY_WEBHOOK_SECRET) {
      const sig = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'] || '';
      const expected = crypto
        .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (sig && sig !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const {
      phone, email, name, program, amount,
      checkout_id, order_id
    } = parseExlyPayload(req.body);

    if (!phone || !program) {
      return res.status(400).json({ error: 'Missing phone or program' });
    }

    const { data: lead } = await db
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const now = new Date();
    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const endDate = new Date(now.getTime() + durationDays * 86400000);

    const { data: client, error } = await db.from('clients').insert({
      lead_id: lead ? lead.id : null,
      phone,
      name: name || '',
      email: email || '',
      program,
      program_started_at: now.toISOString(),
      program_ends_at: endDate.toISOString(),
      paid_amount: amount || 0,
      checkout_id: checkout_id || order_id || null,
      status: 'active'
    }).select('id').single();

    if (error) throw error;

    const market = detectMarket(phone);
    const hinglish = isHinglish(market);

    const onboardMsg = hinglish
      ? `Welcome to FitnessByMaddy! \u{1F525} Tumhara ${program} program start ho gaya hai. Week 1 ka plan jaldi aayega. Koi bhi doubt ho toh yahan message karo!`
      : `Welcome to FitnessByMaddy! \u{1F525} Your ${program} program is now active. Your Week 1 plan will arrive shortly. Message here anytime if you have questions!`;

    await sendWhatsApp(phone, onboardMsg, `onboard_${program}`, true);

    if (program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://fitnessbymaddy.com';

        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (err) {
        console.error('Week 1 program generation failed:', err.message);
      }
    }

    return res.status(200).json({ success: true, clientId: client.id });

  } catch (err) {
    console.error('Exly webhook error:', err.message);
    await escalateToMaddy('Payment webhook processing failed', {
      phone: req.body?.phone || 'unknown',
      message: err.message
    }).catch(() => {});
    return res.status(500).json({ error: 'Internal error' });
  }
};

function parseExlyPayload(body) {
  if (!body) return {};
  return {
    phone: body.phone || body.mobile || body.customer_phone || '',
    email: body.email || body.customer_email || '',
    name: body.name || body.customer_name || '',
    program: body.program || body.product_name || body.plan || '',
    amount: body.amount || body.total_amount || body.price || 0,
    checkout_id: body.checkout_id || body.order_id || '',
    order_id: body.order_id || ''
  };
}
