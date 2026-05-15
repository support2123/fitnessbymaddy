const crypto = require('crypto');
const { getSupabase } = require('../lib/supabase');
const { sendWhatsAppDirect } = require('../lib/whatsapp');
const { detectMarket, isHinglishMarket, getProgramWeeks, getProgramName, maskPhone } = require('../lib/utils');
const { escalateToMaddy } = require('../lib/escalate');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).json({ ok: true });
  }

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

    const {
      phone, email, name, product_name, amount,
      checkout_id, status: paymentStatus
    } = req.body;

    if (paymentStatus === 'failed') {
      await escalateToMaddy({
        reason: 'Payment failure',
        phone,
        details: `Product: ${product_name}, Amount: ${amount}`
      });
      return res.status(200).json({ action: 'payment_failed_escalated' });
    }

    if (!phone || paymentStatus !== 'success') {
      return res.status(400).json({ error: 'Invalid payload' });
    }

    const db = getSupabase();

    const program = mapExlyProduct(product_name);
    const market = detectMarket(phone);
    const hinglish = isHinglishMarket(market);
    const weeks = getProgramWeeks(program);
    const now = new Date();
    const endsAt = new Date(now.getTime() + weeks * 7 * 24 * 60 * 60 * 1000);

    const { data: lead } = await db
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .single();

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const { data: client, error: clientErr } = await db.from('clients').insert({
      lead_id: lead?.id || null,
      phone,
      name,
      email,
      program,
      program_started_at: now.toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: amount ? parseInt(amount) : null,
      checkout_id,
      folder_url: null,
      status: 'active'
    }).select().single();

    if (clientErr) {
      console.error('Client insert error:', clientErr.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    const folderPath = `clients/${client.id}`;
    await db.storage.from('clients').upload(`${folderPath}/.keep`, new Blob(['']));
    await db.from('clients').update({ folder_url: folderPath }).eq('id', client.id);

    const programName = getProgramName(program);
    const onboardMsg = hinglish
      ? `Welcome to ${programName}! Aapka program shuru ho gaya hai. Hum aapko har hafte check-in form bhejenge. Koi bhi sawal ho toh yahan message karein!`
      : `Welcome to ${programName}! Your program has officially started. We'll send you a weekly check-in form. Message us here with any questions!`;

    await sendWhatsAppDirect({
      phone,
      templateName: `onboard_${program}`,
      body: onboardMsg,
      params: [name || 'there', programName]
    });

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
      } catch (e) {
        console.error('Week-1 program generation failed:', e.message);
      }
    }

    return res.status(200).json({
      action: 'converted',
      client_id: client.id,
      program,
      phone: maskPhone(phone)
    });

  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function mapExlyProduct(productName) {
  if (!productName) return '6wk_gym';
  const lower = productName.toLowerCase();
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40+') || lower.includes('40 plus')) return '40plus';
  if (lower.includes('12') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('trial') || lower.includes('zoom trial')) return 'zoom_trial';
  if (lower.includes('zoom pack')) return 'zoom_pack';
  if (lower.includes('home')) return '6wk_home';
  return '6wk_gym';
}
