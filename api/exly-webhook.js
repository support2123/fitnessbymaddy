const crypto = require('crypto');
const { getSupabase } = require('./_lib/supabase');
const { sendMessage } = require('./_lib/whatsapp');
const { maskPhone } = require('./_lib/mask-phone');
const { escalateToMaddy } = require('./_lib/escalation');

const PROGRAM_DURATIONS = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  pcos: 42,
  '40plus': 42,
  zoom_trial: 7,
  zoom_pack: 28,
};

function verifySignature(payload, signature) {
  if (!process.env.EXLY_WEBHOOK_SECRET) return true;
  const expected = crypto
    .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
    .update(JSON.stringify(payload))
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature || ''),
    Buffer.from(expected)
  );
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const sig = req.headers['x-exly-signature'];
    if (!verifySignature(req.body, sig)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const { phone, name, email, program, amount, checkout_id } = req.body;
    if (!phone || !program) {
      return res.status(400).json({ error: 'Missing phone or program' });
    }

    const db = getSupabase();

    const { data: lead } = await db.from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const endsAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString();

    const { data: client, error } = await db.from('clients').insert({
      lead_id: lead ? lead.id : null,
      phone,
      name: name || (lead ? lead.name : null),
      email,
      program,
      program_ends_at: endsAt,
      paid_amount: amount || 0,
      checkout_id,
      folder_url: null,
      status: 'active',
    }).select().single();

    if (error) {
      console.error('Client insert error:', error.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    const folderPath = `clients/${client.id}`;
    await db.storage.from('clients').upload(`${folderPath}/.keep`, new Uint8Array(0), {
      contentType: 'text/plain',
      upsert: true,
    });
    await db.from('clients').update({ folder_url: folderPath }).eq('id', client.id);

    const templateName = `onboard_${program}`;
    await sendMessage(phone, null, templateName, true);

    console.log(`Converted: ${maskPhone(phone)} → ${program}`);
    return res.status(200).json({ success: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    await escalateToMaddy(
      'Payment webhook processing failed',
      `Error: ${err.message}`
    ).catch(() => {});
    return res.status(500).json({ error: 'Internal error' });
  }
};
