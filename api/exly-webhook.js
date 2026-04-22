const { supabase } = require('./_lib/supabase');
const { sendTemplate } = require('./_lib/whatsapp');
const { needsEscalation, escalateToMaddy } = require('./_lib/escalation');
const { maskPhone } = require('./_lib/whatsapp');
const crypto = require('crypto');

const PROGRAM_DURATIONS = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 30,
};

function verifyExlySignature(req) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true;
  const sig = req.headers['x-exly-signature'] || '';
  const body = JSON.stringify(req.body);
  const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
  return sig === expected;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  if (!verifyExlySignature(req)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  try {
    const {
      phone,
      email,
      name,
      product_id,
      checkout_id,
      amount,
      program,
    } = req.body;

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    const programKey = program || product_id || '6wk_gym';
    const durationDays = PROGRAM_DURATIONS[programKey] || 42;
    const now = new Date();
    const endsAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

    const { data: lead } = await supabase
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .single();

    if (lead) {
      await supabase
        .from('leads')
        .update({ status: 'converted', name: name || undefined })
        .eq('id', lead.id);
    }

    const { data: client, error: clientErr } = await supabase
      .from('clients')
      .insert({
        lead_id: lead?.id || null,
        phone,
        name,
        email,
        program: programKey,
        program_started_at: now.toISOString(),
        program_ends_at: endsAt.toISOString(),
        paid_amount: amount || 0,
        checkout_id,
        folder_url: `/clients/${phone}/`,
        status: 'active',
      })
      .select()
      .single();

    if (clientErr) {
      console.error('Client insert error:', clientErr.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    await sendTemplate(phone, `onboard_${programKey}`, [
      name || 'there',
      programKey,
    ]);

    if (programKey === '12wk') {
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'https://fitnessbymaddy.com';

      fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: client.id, week_no: 1 }),
      }).catch(() => {});
    }

    return res.status(200).json({ success: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
