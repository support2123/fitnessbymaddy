const crypto = require('crypto');
const { supabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { logMessage } = require('./_lib/rate-limit');
const { json, PROGRAM_NAMES } = require('./_lib/helpers');

const PROGRAM_DURATIONS = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 1,
  'zoom_pack': 30,
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  try {
    const signature = req.headers['x-exly-signature'];
    if (process.env.EXLY_WEBHOOK_SECRET && signature) {
      const expected = crypto
        .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (signature !== expected) {
        return json(res, 401, { error: 'Invalid signature' });
      }
    }

    const {
      phone, email, name, program, amount,
      checkout_id, status: paymentStatus,
    } = req.body;

    if (!phone || !program) {
      return json(res, 400, { error: 'Missing phone or program' });
    }

    if (paymentStatus && paymentStatus !== 'completed') {
      return json(res, 200, { action: 'ignored', reason: 'payment not completed' });
    }

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (lead) {
      await supabase.from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const now = new Date();
    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const endsAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

    const { data: client, error: clientErr } = await supabase.from('clients').insert({
      lead_id: lead ? lead.id : null,
      phone,
      name: name || (lead ? lead.name : null),
      email,
      program,
      program_started_at: now.toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: amount ? parseInt(amount, 10) : null,
      checkout_id,
      folder_url: null,
      status: 'active',
    }).select().single();

    if (clientErr) {
      console.error('client insert error:', clientErr.message);
      return json(res, 500, { error: 'Failed to create client' });
    }

    const folderPath = `clients/${client.id}`;
    await supabase.storage.from('programs').upload(
      `${folderPath}/.keep`,
      new Uint8Array([0]),
      { contentType: 'application/octet-stream', upsert: true }
    );

    await supabase.from('clients')
      .update({ folder_url: folderPath })
      .eq('id', client.id);

    const programName = PROGRAM_NAMES[program] || program;
    await sendWhatsApp(phone, `onboard_${program}`, [
      name || 'there',
      programName,
    ]);
    await logMessage(phone, 'out', `Welcome to ${programName}!`, `onboard_${program}`);

    return json(res, 200, {
      action: 'converted',
      client_id: client.id,
      program,
    });
  } catch (err) {
    console.error('exly-webhook error:', err.message);
    return json(res, 500, { error: 'Internal error' });
  }
};
