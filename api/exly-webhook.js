const crypto = require('crypto');
const { getSupabase } = require('./lib/supabase');
const { sendTemplate, sendText, notifyMaddy, maskPhone, detectMarket, isHinglish } = require('./lib/whatsapp');

const PROGRAM_MAP = {
  '6wk-gym': '6wk_gym',
  '6wk-home': '6wk_home',
  '12wk': '12wk',
  'pcos': 'pcos',
  '40plus': '40plus',
  'zoom-trial': 'zoom_trial',
  'zoom-pack': 'zoom_pack'
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

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const signature = req.headers['x-exly-signature'];
    if (process.env.EXLY_WEBHOOK_SECRET && signature) {
      const expected = crypto
        .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (signature !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const { phone, email, name, product_id, amount, checkout_id, status: paymentStatus } = req.body;

    if (paymentStatus !== 'paid' && paymentStatus !== 'completed' && paymentStatus !== 'success') {
      if (paymentStatus === 'failed') {
        await handlePaymentFailure(phone, name);
      }
      return res.status(200).json({ status: 'ignored', reason: `payment status: ${paymentStatus}` });
    }

    if (!phone) {
      return res.status(400).json({ error: 'Phone required' });
    }

    const db = getSupabase();
    const program = PROGRAM_MAP[product_id] || product_id || '6wk_gym';
    const durationDays = PROGRAM_DURATIONS[program] || 42;

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    let leadId = lead?.id;

    if (!lead) {
      const { data: newLead } = await db.from('leads').insert({
        phone,
        name: name || null,
        source: 'exly',
        status: 'converted',
        market: detectMarket(phone)
      }).select().single();
      leadId = newLead?.id;
    } else {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const now = new Date();
    const endsAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

    const { data: client, error } = await db.from('clients').insert({
      lead_id: leadId,
      phone,
      name: name || lead?.name || null,
      email: email || null,
      program,
      program_started_at: now.toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: amount ? parseInt(amount) : null,
      checkout_id: checkout_id || null,
      folder_url: null,
      status: 'active'
    }).select().single();

    if (error) {
      console.error('Client insert error:', error.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    try {
      const folderPath = `clients/${client.id}`;
      await db.storage.from('programs').upload(
        `${folderPath}/.keep`,
        new Uint8Array(0),
        { contentType: 'text/plain' }
      );
      await db.from('clients').update({ folder_url: folderPath }).eq('id', client.id);
    } catch (storageErr) {
      console.error('Storage folder creation:', storageErr.message);
    }

    const market = detectMarket(phone);
    const hinglish = isHinglish(market);

    const templateName = `onboard_${program}`;
    await sendTemplate(phone, templateName, [name || 'there']);

    const welcomeMsg = hinglish
      ? `Welcome to the family, ${name || 'Champion'}! 🎉\n\nTumhara *${programLabel(program)}* program aaj se start ho raha hai.\n\n📅 First check-in: 7 din baad\n💪 Let's crush it together!`
      : `Welcome to the family, ${name || 'Champion'}! 🎉\n\nYour *${programLabel(program)}* program starts today.\n\n📅 First check-in: in 7 days\n💪 Let's crush it together!`;

    await sendText(phone, welcomeMsg);

    if (program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://fitnessbymaddy.com';

        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`
          },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (err) {
        console.error('Week-1 program generation failed:', err.message);
      }
    }

    return res.status(200).json({ status: 'ok', client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

async function handlePaymentFailure(phone, name) {
  if (!phone) return;

  const db = getSupabase();
  const { data: client } = await db
    .from('clients')
    .select('*')
    .eq('phone', phone)
    .eq('status', 'active')
    .single();

  if (client) {
    await notifyMaddy('Payment failure for active client', {
      phone: maskPhone(phone),
      message: `Active client ${name || client.name || 'Unknown'} had a payment failure.`
    });
  }
}

function programLabel(program) {
  const labels = {
    '6wk_gym': '6-Week Burn & Build (Gym)',
    '6wk_home': '6-Week Burn & Build (Home)',
    '12wk': '12-Week Custom Flagship',
    'pcos': 'PCOS Warrior',
    '40plus': '40+ Strong',
    'zoom_trial': 'Zoom Trial',
    'zoom_pack': 'Zoom Session Pack'
  };
  return labels[program] || program;
}
