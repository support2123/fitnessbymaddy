const crypto = require('crypto');
const { getSupabase } = require('./lib/supabase');
const { sendTemplate, detectMarket } = require('./lib/whatsapp');

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

function verifyWebhookSignature(body, signature) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true;
  const computed = crypto.createHmac('sha256', secret)
    .update(JSON.stringify(body))
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(computed),
    Buffer.from(signature || '')
  );
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const signature = req.headers['x-exly-signature'] || '';
    if (process.env.EXLY_WEBHOOK_SECRET && !verifyWebhookSignature(req.body, signature)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const {
      phone, name, email, checkout_id, product_slug,
      amount, status
    } = req.body;

    if (status !== 'completed' && status !== 'paid') {
      if (status === 'failed') {
        const { createEscalation } = require('./lib/escalation');
        await createEscalation(phone, 'Payment failed', `Payment failed for ${product_slug}`);
      }
      return res.json({ action: 'ignored', status });
    }

    const program = PROGRAM_MAP[product_slug] || '12wk';
    const durationDays = PROGRAM_DURATIONS[program] || 42;

    const db = getSupabase();

    const { data: lead } = await db
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .limit(1)
      .single();

    if (lead) {
      await db.from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + durationDays * 24 * 60 * 60 * 1000);

    const { data: client } = await db.from('clients').insert({
      lead_id: lead?.id || null,
      phone,
      name,
      email,
      program,
      program_started_at: startDate.toISOString(),
      program_ends_at: endDate.toISOString(),
      paid_amount: amount ? parseInt(amount) : null,
      checkout_id,
      folder_url: null,
      status: 'active'
    }).select().single();

    const market = detectMarket(phone);
    await sendTemplate(phone, `onboard_${program}`, {
      name: name || 'there',
      templateParams: [
        name || 'there',
        endDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
      ]
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
        console.error('Week-1 program generation failed:', e.message);
      }
    }

    return res.json({ ok: true, client_id: client?.id, program });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Processing failed' });
  }
};
