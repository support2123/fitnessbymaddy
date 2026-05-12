const crypto = require('crypto');
const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');

const PROGRAM_DURATION = {
  '6wk_gym': 42, '6wk_home': 42, '12wk': 84, 'pcos': 42,
  '40plus': 42, 'zoom_trial': 7, 'zoom_pack': 28,
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

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
      phone, name, email, program, amount, checkout_id,
    } = req.body || {};

    if (!phone || !program) {
      return res.status(400).json({ error: 'phone and program required' });
    }

    const normalizedPhone = normalizePhone(phone);
    const sb = getSupabase();

    const { data: lead } = await sb
      .from('leads')
      .select('id')
      .eq('phone', normalizedPhone)
      .single();

    if (lead) {
      await sb.from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const durationDays = PROGRAM_DURATION[program] || 42;
    const programEnds = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString();
    const folderPath = `clients/${crypto.randomUUID()}`;

    const { data: client, error } = await sb
      .from('clients')
      .insert({
        lead_id: lead ? lead.id : null,
        phone: normalizedPhone,
        name: name || null,
        email: email || null,
        program,
        program_started_at: new Date().toISOString(),
        program_ends_at: programEnds,
        paid_amount: amount ? parseInt(amount, 10) : 0,
        checkout_id: checkout_id || null,
        folder_url: folderPath,
        status: 'active',
      })
      .select()
      .single();

    if (error) throw error;

    await sendWhatsApp(normalizedPhone, `onboard_${program}`, [
      name || 'there',
      `Day 7 check-in coming soon!`,
    ]);

    if (program === '12wk') {
      try {
        const origin = `https://${req.headers.host || 'www.fitnessbymaddy.com'}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch (genErr) {
        console.error('Week-1 generation failed:', genErr.message);
      }
    }

    return res.status(200).json({ ok: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function normalizePhone(raw) {
  let phone = (raw || '').replace(/[^0-9+]/g, '');
  if (!phone.startsWith('+') && phone.length >= 10) phone = '+' + phone;
  return phone;
}
