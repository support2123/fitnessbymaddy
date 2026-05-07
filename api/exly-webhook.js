const crypto = require('crypto');
const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');
const { detectMarket, isHinglish } = require('./lib/market');

const PROGRAM_DURATIONS = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 84
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    if (process.env.EXLY_WEBHOOK_SECRET) {
      const sig = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'];
      if (sig) {
        const expected = crypto.createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
          .update(JSON.stringify(req.body))
          .digest('hex');
        if (sig !== expected) {
          return res.status(401).json({ error: 'Invalid signature' });
        }
      }
    }

    const { phone, name, email, program, amount, checkout_id } = parseExlyPayload(req.body);
    if (!phone || !program) {
      return res.status(400).json({ error: 'Missing phone or program' });
    }

    const db = getSupabase();

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const programEnds = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000);

    const { data: client, error } = await db.from('clients').insert({
      lead_id: lead?.id || null,
      phone,
      name: name || lead?.name || null,
      email: email || null,
      program,
      program_started_at: new Date().toISOString(),
      program_ends_at: programEnds.toISOString(),
      paid_amount: amount ? parseInt(amount) : null,
      checkout_id: checkout_id || null,
      folder_url: null,
      status: 'active'
    }).select().single();

    if (error) {
      console.error('Client insert error:', error.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    const folderPath = `clients/${client.id}`;
    await db.from('clients').update({ folder_url: folderPath }).eq('id', client.id);

    const market = detectMarket(phone);
    const hinglish = isHinglish(market);

    const welcomeMsg = hinglish
      ? `🎉 Welcome to the team, ${name || 'champion'}!\n\nTera ${programLabel(program)} program shuru ho gaya hai! 💪\n\nPehle week ka check-in form Day 7 pe aayega.\n\nKoi sawaal ho toh message kar — hum yahaan hain!`
      : `🎉 Welcome to the team, ${name || 'champion'}!\n\nYour ${programLabel(program)} program has officially started! 💪\n\nYour first check-in form will arrive on Day 7.\n\nGot questions? Just message us — we're here for you!`;

    await sendWhatsApp({ phone, templateName: `onboard_${program}`, body: welcomeMsg });

    if (program === '12wk') {
      try {
        const origin = `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (genErr) {
        console.error('Week-1 program generation failed:', genErr.message);
      }
    }

    return res.status(200).json({ success: true, clientId: client.id });

  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function parseExlyPayload(body) {
  if (!body) return {};
  return {
    phone: body.phone || body.customer_phone || body.mobile,
    name: body.name || body.customer_name,
    email: body.email || body.customer_email,
    program: body.program || body.product_name || body.plan,
    amount: body.amount || body.total_amount || body.price,
    checkout_id: body.checkout_id || body.order_id || body.transaction_id
  };
}

function programLabel(program) {
  const labels = {
    '6wk_gym': '6-Week Burn & Build (Gym)',
    '6wk_home': '6-Week Burn & Build (Home)',
    '12wk': '12-Week Custom Training',
    'pcos': 'PCOS Warrior',
    '40plus': '40+ Strong',
    'zoom_trial': 'Zoom Trial',
    'zoom_pack': 'Zoom Pack'
  };
  return labels[program] || program;
}
