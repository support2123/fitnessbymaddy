const crypto = require('crypto');
const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');
const { isHinglish, detectMarket } = require('./lib/market');

const PROGRAM_MAP = {
  '6-week-burn-build': '6wk_gym',
  '6-week-home': '6wk_home',
  '12-week-flagship': '12wk',
  'pcos-warrior': 'pcos',
  '40plus-strong': '40plus',
  'zoom-trial': 'zoom_trial',
  'zoom-pack': 'zoom_pack'
};

const PROGRAM_DURATION_WEEKS = {
  '6wk_gym': 6,
  '6wk_home': 6,
  '12wk': 12,
  'pcos': 8,
  '40plus': 8,
  'zoom_trial': 1,
  'zoom_pack': 4
};

function verifyWebhookSignature(body, signature) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true;
  const computed = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(body))
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature || ''),
    Buffer.from(computed)
  );
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabase = getSupabase();

  try {
    const signature = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'];
    if (process.env.EXLY_WEBHOOK_SECRET && !verifyWebhookSignature(req.body, signature)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const {
      customer_phone, customer_name, customer_email,
      product_slug, checkout_id, amount
    } = req.body;

    if (!customer_phone) {
      return res.status(400).json({ error: 'Missing customer phone' });
    }

    const program = PROGRAM_MAP[product_slug] || product_slug || '6wk_gym';
    const durationWeeks = PROGRAM_DURATION_WEEKS[program] || 6;
    const now = new Date();
    const endsAt = new Date(now.getTime() + durationWeeks * 7 * 24 * 60 * 60 * 1000);

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', customer_phone)
      .single();

    if (lead) {
      await supabase
        .from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const { data: client, error: clientErr } = await supabase
      .from('clients')
      .insert({
        lead_id: lead?.id || null,
        phone: customer_phone,
        name: customer_name || lead?.name || null,
        email: customer_email || null,
        program,
        program_started_at: now.toISOString(),
        program_ends_at: endsAt.toISOString(),
        paid_amount: amount ? parseInt(amount) : null,
        checkout_id: checkout_id || null,
        folder_url: null,
        status: 'active'
      })
      .select()
      .single();

    if (clientErr) {
      console.error('Client creation error:', clientErr.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    const folderPath = `clients/${client.id}`;
    await supabase.storage
      .from('client-files')
      .upload(`${folderPath}/.keep`, new Blob(['']))
      .catch(() => {});

    await supabase
      .from('clients')
      .update({ folder_url: folderPath })
      .eq('id', client.id);

    const market = detectMarket(customer_phone);
    const hinglish = isHinglish(market);

    const onboardMsg = hinglish
      ? `Welcome to the ${program.replace(/_/g, ' ')} program! Tumhara journey shuru ho gaya hai. Week 1 ka plan jaldi aayega. Koi bhi question ho toh yahan poocho!`
      : `Welcome to the ${program.replace(/_/g, ' ')} program! Your journey starts now. Your Week 1 plan will arrive shortly. Feel free to ask any questions here!`;

    await sendWhatsApp({
      phone: customer_phone,
      templateName: `onboard_${program}`,
      body: onboardMsg,
      isClient: true
    });

    if (program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://www.fitnessbymaddy.com';
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (genErr) {
        console.error('Week 1 program generation failed:', genErr.message);
      }
    }

    return res.status(200).json({ success: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
