const crypto = require('crypto');
const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { isHinglish, maskPhone } = require('../lib/helpers');

function verifySignature(body, signature) {
  if (!process.env.EXLY_WEBHOOK_SECRET) return true;
  const expected = crypto
    .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
    .update(JSON.stringify(body))
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature || ''), Buffer.from(expected));
}

const PROGRAM_WEEKS = {
  '6wk_gym': 6,
  '6wk_home': 6,
  '12wk': 12,
  pcos: 6,
  '40plus': 6,
  zoom_trial: 1,
  zoom_pack: 4,
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const signature = req.headers['x-exly-signature'] || '';
  if (!verifySignature(req.body, signature)) {
    return res.status(403).json({ error: 'Invalid signature' });
  }

  const db = getSupabase();

  try {
    const {
      buyer_phone, buyer_name, buyer_email,
      product_name, amount, checkout_id, status,
    } = req.body;

    if (status !== 'completed' && status !== 'success') {
      if (status === 'failed') {
        const { data: lead } = await db
          .from('leads')
          .select('*')
          .eq('phone', buyer_phone)
          .single();
        if (lead && lead.status === 'qualified') {
          const { escalateToMaddy } = require('../lib/escalation');
          await escalateToMaddy('Payment failed for qualified lead', {
            phone: buyer_phone,
            name: buyer_name,
            message: `Payment of $${amount} failed for ${product_name}`,
          });
        }
      }
      return res.status(200).json({ action: 'ignored', status });
    }

    const programSlug = mapProductToSlug(product_name);
    const weeks = PROGRAM_WEEKS[programSlug] || 6;
    const endsAt = new Date();
    endsAt.setDate(endsAt.getDate() + weeks * 7);

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', buyer_phone)
      .single();

    if (lead) {
      await db
        .from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const { data: client, error: clientErr } = await db.from('clients').insert({
      lead_id: lead?.id || null,
      phone: buyer_phone,
      name: buyer_name,
      email: buyer_email,
      program: programSlug,
      program_started_at: new Date().toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: Math.round(amount * 100),
      checkout_id,
      folder_url: `/clients/${checkout_id}/`,
      status: 'active',
    }).select().single();

    if (clientErr) {
      console.error('client insert error:', clientErr.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    const market = lead?.market || 'GLOBAL';
    let welcomeMsg;
    if (isHinglish(market)) {
      welcomeMsg =
        `Welcome to ${programSlug === '12wk' ? '12-Week Flagship' : 'FitnessByMaddy'}! 🎉\n\n` +
        `Payment confirmed. Aapka program ab start ho raha hai.\n\n` +
        `Pehla check-in 7 din mein aayega. Tab tak form fill karo agar nahi kiya:\n` +
        `https://fitnessbymaddy.com/intake.html?lead=${lead?.id || ''}`;
    } else {
      welcomeMsg =
        `Welcome to FitnessByMaddy! 🎉\n\n` +
        `Payment confirmed. Your program starts now.\n\n` +
        `Your first check-in will arrive in 7 days. Fill this form if you haven't:\n` +
        `https://fitnessbymaddy.com/intake.html?lead=${lead?.id || ''}`;
    }

    await sendWhatsApp(buyer_phone, welcomeMsg, `onboard_${programSlug}`);

    if (programSlug === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://fitnessbymaddy.com';
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.INTERNAL_API_KEY}`,
          },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch (e) {
        console.error('week-1 program generation failed:', e.message);
      }
    }

    return res.status(200).json({ ok: true, client_id: client.id });
  } catch (err) {
    console.error('exly-webhook error:', maskPhone(req.body?.buyer_phone), err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function mapProductToSlug(productName) {
  if (!productName) return '6wk_gym';
  const lower = productName.toLowerCase();
  if (lower.includes('12') || lower.includes('flagship') || lower.includes('custom')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40') || lower.includes('strong')) return '40plus';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('trial') || lower.includes('zoom')) return 'zoom_trial';
  if (lower.includes('pack')) return 'zoom_pack';
  return '6wk_gym';
}
