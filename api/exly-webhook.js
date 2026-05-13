const crypto = require('crypto');
const { supabase } = require('../lib/supabase');
const { sendWhatsAppForced } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');

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
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    if (process.env.EXLY_WEBHOOK_SECRET) {
      const signature = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'];
      if (signature) {
        const expected = crypto
          .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
          .update(JSON.stringify(req.body))
          .digest('hex');
        if (signature !== expected) {
          return res.status(401).json({ error: 'Invalid signature' });
        }
      }
    }

    const { phone, email, name, program, amount, checkout_id } = parseExlyPayload(req.body);
    if (!phone || !program) {
      return res.status(400).json({ error: 'Missing phone or program' });
    }

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (lead) {
      await supabase.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const programEnds = new Date();
    programEnds.setDate(programEnds.getDate() + durationDays);

    const folderPath = `clients/${crypto.randomUUID()}`;

    const { data: client, error } = await supabase.from('clients').insert({
      lead_id: lead ? lead.id : null,
      phone,
      name: name || (lead ? lead.name : null),
      email,
      program,
      paid_amount: amount || 0,
      checkout_id,
      folder_url: folderPath,
      program_started_at: new Date().toISOString(),
      program_ends_at: programEnds.toISOString(),
      status: 'active'
    }).select().single();

    if (error) {
      console.error('Client insert error:', error.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    const market = lead ? lead.market : detectMarket(phone);
    const hinglish = isHinglish(market);

    const welcomeMsg = hinglish
      ? `Welcome to FitnessByMaddy! 🎉 Aapka ${program} program start ho gaya hai. Maddy ki team aapko guide karegi har step pe. First check-in Day 7 ko aayega!`
      : `Welcome to FitnessByMaddy! 🎉 Your ${program} program has started. Maddy's team will guide you every step. First check-in comes on Day 7!`;

    await sendWhatsAppForced({
      phone,
      templateName: `onboard_${program}`,
      body: welcomeMsg,
      params: [name || 'there', program]
    });

    if (program === '12wk') {
      try {
        const origin = `https://${req.headers.host || 'www.fitnessbymaddy.com'}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (genErr) {
        console.error('Week-1 program gen failed:', genErr.message);
      }
    }

    return res.json({ ok: true, client_id: client.id, program });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function parseExlyPayload(body) {
  if (!body) return {};
  const data = body.data || body;
  return {
    phone: data.phone || data.mobile || data.customer_phone,
    email: data.email || data.customer_email,
    name: data.name || data.customer_name,
    program: mapExlyProduct(data.product || data.product_name || data.plan),
    amount: data.amount || data.paid_amount || data.total,
    checkout_id: data.checkout_id || data.order_id || data.transaction_id
  };
}

function mapExlyProduct(product) {
  if (!product) return '6wk_gym';
  const lower = product.toLowerCase();
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40')) return '40plus';
  if (lower.includes('12') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('trial') || lower.includes('zoom')) return 'zoom_trial';
  if (lower.includes('pack')) return 'zoom_pack';
  return '6wk_gym';
}
