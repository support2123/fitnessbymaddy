const crypto = require('crypto');
const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');

const PROGRAM_DURATIONS = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 30,
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
      phone, name, email, program, amount,
      checkout_id, event_type,
    } = req.body;

    if (event_type === 'payment_failed') {
      const { escalateToMaddy } = require('../lib/escalation');
      const { maskPhone } = require('../lib/whatsapp');
      await escalateToMaddy(
        'Payment failed for lead',
        `Phone: ${maskPhone(phone)} — Program: ${program}`
      );
      return res.json({ action: 'payment_failure_escalated' });
    }

    if (event_type !== 'purchase' && event_type !== 'payment_success') {
      return res.json({ action: 'ignored', event_type });
    }

    if (!phone || !program) {
      return res.status(400).json({ error: 'phone and program required' });
    }

    const db = getSupabase();

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const startsAt = new Date();
    const endsAt = new Date(startsAt.getTime() + durationDays * 86400000);

    const { data: client, error } = await db.from('clients').insert({
      lead_id: lead?.id || null,
      phone,
      name: name || lead?.name || null,
      email,
      program,
      program_started_at: startsAt.toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: amount ? parseInt(amount) : 0,
      checkout_id,
      status: 'active',
    }).select().single();

    if (error) throw error;

    const folderPath = `clients/${client.id}`;
    await db.storage.from('programs').upload(`${folderPath}/.keep`, new Uint8Array(0), {
      upsert: true,
    });
    await db.from('clients').update({ folder_url: folderPath }).eq('id', client.id);

    await sendWhatsApp(phone, `onboard_${program}`, [name || 'there']);

    if (program === '12wk') {
      try {
        await fetch('https://www.fitnessbymaddy.com/api/generate-program', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch (_) {
        // async — will retry via cron if missed
      }
    }

    return res.json({ action: 'client_created', client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
