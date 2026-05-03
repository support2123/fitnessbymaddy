const crypto = require('crypto');
const { getSupabase } = require('./_lib/supabase');
const { sendTemplate } = require('./_lib/whatsapp');
const { maskPhone } = require('./_lib/market');
const { escalateToMaddy } = require('./_lib/escalation');

const PROGRAM_DURATIONS = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 30,
};

function verifySignature(body, signature) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true;
  const expected = crypto.createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature || ''), Buffer.from(expected));
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

  try {
    const sig = req.headers['x-exly-signature'] || '';
    if (process.env.EXLY_WEBHOOK_SECRET && !verifySignature(req.body, sig)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const {
      phone, email, name, program, amount,
      checkout_id, payment_status,
    } = req.body || {};

    if (payment_status && payment_status !== 'completed') {
      if (payment_status === 'failed') {
        const cleanPhone = phone?.startsWith('+') ? phone : `+${phone}`;
        await escalateToMaddy('Payment failed', cleanPhone, `Program: ${program}, Amount: ${amount}`);
      }
      return res.status(200).json({ action: 'payment_not_completed' });
    }

    const cleanPhone = phone?.startsWith('+') ? phone : `+${phone}`;
    if (!cleanPhone || cleanPhone.length < 8) {
      return res.status(400).json({ error: 'Invalid phone' });
    }

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', cleanPhone)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    const leadId = lead?.id || null;
    if (leadId) {
      await db.from('leads')
        .update({ status: 'converted' })
        .eq('id', leadId);
    }

    const programKey = program || lead?.program_interest || '6wk_gym';
    const durationDays = PROGRAM_DURATIONS[programKey] || 42;
    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + durationDays * 24 * 60 * 60 * 1000);

    const { data: client } = await db.from('clients').insert({
      lead_id: leadId,
      phone: cleanPhone,
      name: name || lead?.name || '',
      email: email || '',
      program: programKey,
      program_started_at: startDate.toISOString(),
      program_ends_at: endDate.toISOString(),
      paid_amount: amount ? parseFloat(amount) : 0,
      checkout_id: checkout_id || null,
      folder_url: null,
      status: 'active',
    }).select().single();

    if (client) {
      const folderPath = `clients/${client.id}`;
      await db.storage.from('programs').upload(`${folderPath}/.keep`, new Uint8Array(0), {
        contentType: 'application/octet-stream',
        upsert: true,
      });
      await db.from('clients')
        .update({ folder_url: folderPath })
        .eq('id', client.id);
    }

    const templateName = `onboard_${programKey}`;
    await sendTemplate(cleanPhone, templateName, [name || 'there'], true);

    if (programKey === '12wk' && client) {
      try {
        await fetch(`${process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : ''}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch (e) {
        console.error(`Auto-generate week 1 failed: ${e.message}`);
      }
    }

    console.log(`Converted: ${maskPhone(cleanPhone)} → ${programKey}`);
    return res.status(200).json({ success: true, clientId: client?.id });
  } catch (err) {
    console.error(`Exly webhook error: ${err.message}`);
    return res.status(500).json({ error: 'Internal error' });
  }
};
