const { getClient } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { escalateToMaddy } = require('../lib/escalation');
const { maskPhone } = require('../lib/whatsapp');
const crypto = require('crypto');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const secret = process.env.EXLY_WEBHOOK_SECRET;
    if (secret) {
      const sig = req.headers['x-exly-signature'] || '';
      const raw = JSON.stringify(req.body);
      const expected = crypto
        .createHmac('sha256', secret)
        .update(raw)
        .digest('hex');
      if (sig !== expected) {
        return res.status(401).json({ error: 'invalid signature' });
      }
    }

    const {
      checkout_id,
      phone,
      name,
      email,
      product,
      amount,
      status,
    } = req.body;

    if (status !== 'paid' && status !== 'completed') {
      if (status === 'failed') {
        await escalateToMaddy('Payment failed for lead', {
          phone: maskPhone(phone),
          detail: `Checkout ${checkout_id}, amount ${amount}`,
        });
      }
      return res.json({ action: 'ignored', status });
    }

    const db = getClient();

    const programMap = {
      '6wk_gym': { weeks: 6 },
      '6wk_home': { weeks: 6 },
      '12wk': { weeks: 12 },
      'pcos': { weeks: 6 },
      '40plus': { weeks: 8 },
      'zoom_trial': { weeks: 1 },
      'zoom_pack': { weeks: 4 },
    };

    const program = product || '6wk_gym';
    const config = programMap[program] || { weeks: 6 };
    const now = new Date();
    const endsAt = new Date(now);
    endsAt.setDate(endsAt.getDate() + config.weeks * 7);

    const { data: lead } = await db
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .single();

    const leadId = lead ? lead.id : null;

    if (leadId) {
      await db
        .from('leads')
        .update({ status: 'converted' })
        .eq('id', leadId);
    }

    const folderPath = `clients/${crypto.randomUUID()}`;

    const { data: client, error } = await db
      .from('clients')
      .insert({
        lead_id: leadId,
        phone,
        name: name || null,
        email: email || null,
        program,
        program_started_at: now.toISOString(),
        program_ends_at: endsAt.toISOString(),
        paid_amount: parseInt(amount, 10) || 0,
        checkout_id: checkout_id || null,
        folder_url: folderPath,
        status: 'active',
      })
      .select()
      .single();

    if (error) {
      console.error('exly-webhook client insert error:', error.message);
      return res.status(500).json({ error: 'db_error' });
    }

    await sendTemplate(phone, `onboard_${program}`, [
      name || 'there',
    ]);

    if (program === '12wk') {
      try {
        const origin = `https://${req.headers.host}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch (e) {
        console.error('Week 1 program generation failed:', e.message);
      }
    }

    return res.json({ success: true, client_id: client.id });
  } catch (err) {
    console.error('exly-webhook error:', err.message);
    return res.status(500).json({ error: 'internal' });
  }
};
