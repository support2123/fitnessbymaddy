const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, maskPhone } = require('../lib/whatsapp');
const { escalateToMaddy } = require('../lib/escalation');
const crypto = require('crypto');

const PROGRAM_MAP = {
  '6_week_shred': '6wk_gym',
  '6_week_home': '6wk_home',
  '12_week': '12wk',
  'pcos_warrior': 'pcos',
  '40_plus': '40plus',
  'zoom_trial': 'zoom_trial',
  'zoom_pack': 'zoom_pack',
};

const PROGRAM_DURATIONS = {
  '6wk_gym': 42, '6wk_home': 42,
  '12wk': 84, 'pcos': 42,
  '40plus': 42, 'zoom_trial': 7, 'zoom_pack': 28,
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (process.env.EXLY_WEBHOOK_SECRET) {
    const signature = req.headers['x-exly-signature'] || '';
    const expected = crypto
      .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
      .update(JSON.stringify(req.body))
      .digest('hex');
    if (signature !== expected) {
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }

  try {
    const { phone, email, name, product, amount, checkout_id, status } = req.body;

    if (status === 'failed') {
      await escalateToMaddy(
        'Payment failure',
        `Phone: ${maskPhone(phone)}, Product: ${product}, Amount: ${amount}`
      );
      return res.status(200).json({ action: 'payment_failed_escalated' });
    }

    if (status !== 'completed' && status !== 'success') {
      return res.status(200).json({ action: 'ignored', reason: 'not a completed payment' });
    }

    const db = getSupabase();
    const program = PROGRAM_MAP[product] || '12wk';
    const durationDays = PROGRAM_DURATIONS[program] || 42;

    const now = new Date();
    const endsAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const { data: client } = await db.from('clients').upsert({
      lead_id: lead?.id || null,
      phone, name, email, program,
      program_started_at: now.toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: amount,
      checkout_id,
      folder_url: `/clients/${checkout_id}/`,
      status: 'active',
    }, { onConflict: 'phone' }).select().single();

    await sendWhatsApp(phone, null, `onboard_${program}`);

    if (program === '12wk') {
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'https://fitnessbymaddy.com';
      try {
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`,
          },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch (genErr) {
        console.error('Week-1 program generation failed:', genErr.message);
      }
    }

    return res.status(200).json({ ok: true, client_id: client.id, program });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
