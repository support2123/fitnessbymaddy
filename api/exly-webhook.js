const crypto = require('crypto');
const { getSupabase } = require('./_lib/supabase');
const { sendClientMessage } = require('./_lib/whatsapp');
const { escalateToMaddy } = require('./_lib/escalation');

const PROGRAM_MAP = {
  '6wk-burn-build-gym': '6wk_gym',
  '6wk-burn-build-home': '6wk_home',
  '6wk-burn-build': '6wk_gym',
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

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    if (process.env.EXLY_WEBHOOK_SECRET) {
      const signature = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'];
      if (signature) {
        const expected = crypto
          .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
          .update(JSON.stringify(req.body))
          .digest('hex');
        if (signature !== expected) {
          return res.status(401).json({ error: 'Invalid signature' });
        }
      }
    }

    const {
      phone, name, email, product_id, product_name,
      amount, checkout_id, status: paymentStatus
    } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'Phone is required' });
    }

    if (paymentStatus === 'failed') {
      const db = getSupabase();
      const { data: lead } = await db.from('leads').select('*').eq('phone', phone.replace(/[^0-9]/g, '')).single();
      if (lead) {
        await escalateToMaddy('Payment failure', {
          phone,
          name: name || lead.name,
          message: `Payment failed for ${product_name || product_id}. Amount: $${(amount || 0) / 100}`
        });
      }
      return res.status(200).json({ action: 'payment_failed_escalated' });
    }

    const cleanPhone = phone.replace(/[^0-9]/g, '');
    const program = PROGRAM_MAP[product_id] || PROGRAM_MAP[product_name] || '12wk';
    const durationDays = PROGRAM_DURATIONS[program] || 42;

    const db = getSupabase();

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', cleanPhone)
      .single();

    if (lead) {
      await db.from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const now = new Date();
    const endsAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

    const { data: client, error: clientErr } = await db
      .from('clients')
      .insert({
        lead_id: lead?.id || null,
        phone: cleanPhone,
        name: name || lead?.name,
        email: email || null,
        program,
        program_started_at: now.toISOString(),
        program_ends_at: endsAt.toISOString(),
        paid_amount: amount || 0,
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
    await db.storage.from('programs').upload(`${folderPath}/.keep`, new Uint8Array(0), {
      contentType: 'text/plain',
      upsert: true
    });

    await db.from('clients')
      .update({ folder_url: folderPath })
      .eq('id', client.id);

    await sendClientMessage(cleanPhone, `onboard_${program}`, [
      client.name || 'there',
      String(durationDays / 7)
    ]);

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
        console.error('Week 1 program generation error:', genErr.message);
      }
    }

    return res.status(200).json({
      ok: true,
      action: 'client_created',
      client_id: client.id,
      program
    });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
