const crypto = require('crypto');
const { supabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { detectMarket } = require('./_lib/market');

const PROGRAM_MAP = {
  'zoom-trial': { program: 'zoom_trial', weeks: 0, price: 20 },
  'zoom_trial': { program: 'zoom_trial', weeks: 0, price: 20 },
  '6wk-gym': { program: '6wk_gym', weeks: 6, price: 97 },
  '6wk_gym': { program: '6wk_gym', weeks: 6, price: 97 },
  '6wk-home': { program: '6wk_home', weeks: 6, price: 77 },
  '6wk_home': { program: '6wk_home', weeks: 6, price: 77 },
  '12wk': { program: '12wk', weeks: 12, price: 200 },
  '12-week': { program: '12wk', weeks: 12, price: 200 },
  'pcos': { program: 'pcos', weeks: 6, price: 45 },
  '40plus': { program: '40plus', weeks: 6, price: 50 },
  'zoom-pack': { program: 'zoom_pack', weeks: 4, price: 80 }
};

function verifyWebhookSignature(body, signature) {
  if (!process.env.EXLY_WEBHOOK_SECRET) return true;
  const expected = crypto
    .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
    .update(JSON.stringify(body))
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature || ''), Buffer.from(expected));
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const signature = req.headers['x-webhook-secret'] || req.headers['x-exly-signature'];
    if (process.env.EXLY_WEBHOOK_SECRET && !verifyWebhookSignature(req.body, signature)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const { phone, email, name, checkout_id, product_id, amount } = req.body;

    if (!phone) return res.status(400).json({ error: 'Phone required' });

    const programKey = product_id || checkout_id || '';
    const programInfo = PROGRAM_MAP[programKey] || PROGRAM_MAP['zoom_trial'];

    const now = new Date();
    const endsAt = programInfo.weeks > 0
      ? new Date(now.getTime() + programInfo.weeks * 7 * 24 * 60 * 60 * 1000)
      : null;

    const { data: lead } = await supabase
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .single();

    if (lead) {
      await supabase.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const { data: client, error } = await supabase.from('clients').insert({
      lead_id: lead?.id || null,
      phone,
      name,
      email,
      program: programInfo.program,
      program_started_at: now.toISOString(),
      program_ends_at: endsAt?.toISOString() || null,
      paid_amount: amount || programInfo.price * 100,
      checkout_id: checkout_id || null,
      folder_url: null,
      status: 'active'
    }).select().single();

    if (error) throw error;

    const folderPath = `clients/${client.id}`;
    await supabase.storage
      .from('programs')
      .upload(`${folderPath}/.keep`, new Blob(['']))
      .catch(() => {});

    await supabase.from('clients')
      .update({ folder_url: folderPath })
      .eq('id', client.id);

    const market = detectMarket(phone);
    let onboardMsg;
    if (market === 'IN') {
      onboardMsg = `Welcome to the team! 🎉 Tumhara ${programInfo.program === '12wk' ? '12-Week Custom' : 'program'} shuru ho gaya hai.\n\n` +
        `📝 Agar intake form nahi bhara toh yahan se fill karo: https://fitnessbymaddy.com/intake.html?lead=${lead?.id || ''}\n\n` +
        `Week 1 ka plan jaldi aayega. Let's do this! 💪`;
    } else {
      onboardMsg = `Welcome to the team! 🎉 Your ${programInfo.program === '12wk' ? '12-Week Custom Program' : 'program'} starts now.\n\n` +
        `📝 If you haven't filled the intake form yet: https://fitnessbymaddy.com/intake.html?lead=${lead?.id || ''}\n\n` +
        `Your Week 1 plan is coming soon. Let's go! 💪`;
    }
    await sendWhatsApp(phone, onboardMsg, `onboard_${programInfo.program}`);

    if (programInfo.program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://fitnessbymaddy.com';
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (_) {}
    }

    return res.status(200).json({ success: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
