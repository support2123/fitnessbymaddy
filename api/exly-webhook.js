const crypto = require('crypto');
const { supabase } = require('./lib/supabase');
const { sendWhatsApp, detectMarket } = require('./lib/whatsapp');

const PROGRAM_MAP = {
  '6wk-burn-build': '6wk_gym',
  '6wk-home': '6wk_home',
  '12wk-flagship': '12wk',
  'pcos-warrior': 'pcos',
  '40plus-strong': '40plus',
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
  'zoom_pack': 28
};

function verifySignature(body, signature) {
  if (!process.env.EXLY_WEBHOOK_SECRET) return true;
  const hash = crypto
    .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
    .update(JSON.stringify(body))
    .digest('hex');
  return hash === signature;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const signature = req.headers['x-exly-signature'];
  if (!verifySignature(req.body, signature)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  try {
    const {
      customer_phone, customer_name, customer_email,
      product_id, amount, checkout_id, status
    } = req.body;

    if (status !== 'completed' && status !== 'paid') {
      return res.status(200).json({ action: 'ignored', reason: 'payment not completed' });
    }

    const phone = customer_phone;
    const program = PROGRAM_MAP[product_id] || '6wk_gym';
    const durationDays = PROGRAM_DURATIONS[program] || 42;

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (lead) {
      await supabase.from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const programStart = new Date();
    const programEnd = new Date(programStart.getTime() + durationDays * 24 * 60 * 60 * 1000);

    const { data: client } = await supabase.from('clients').insert({
      lead_id: lead?.id || null,
      phone,
      name: customer_name,
      email: customer_email,
      program,
      program_started_at: programStart.toISOString(),
      program_ends_at: programEnd.toISOString(),
      paid_amount: parseInt(amount) || 0,
      checkout_id,
      folder_url: `clients/${lead?.id || 'direct'}`,
      status: 'active'
    }).select().single();

    const folderPath = `clients/${client.id}`;
    await supabase.storage
      .from('client-files')
      .upload(`${folderPath}/.keep`, '', {
        contentType: 'text/plain',
        upsert: true
      });

    const market = detectMarket(phone);
    const isHinglish = market === 'IN';

    const welcomeMsg = isHinglish
      ? `Welcome to the team, ${customer_name}! 🎉 Tumhara ${program.replace(/_/g, ' ')} program start ho gaya hai. First check-in Day 7 ko hoga. Let's crush it!`
      : `Welcome to the team, ${customer_name}! 🎉 Your ${program.replace(/_/g, ' ')} program starts now. First check-in is on Day 7. Let's crush it!`;

    await sendWhatsApp({
      phone,
      templateName: `onboard_${program}`,
      body: welcomeMsg
    });

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
      } catch (e) {
        console.error('Week 1 program generation failed:', e.message);
      }
    }

    return res.status(200).json({ success: true, clientId: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
