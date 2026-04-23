const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { corsHeaders, parseBody, PROGRAM_NAMES, PROGRAM_DURATIONS_WEEKS } = require('./_lib/utils');
const crypto = require('crypto');

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const body = await parseBody(req);

  if (process.env.EXLY_WEBHOOK_SECRET) {
    const sig = req.headers['x-webhook-signature'] || req.headers['x-exly-signature'];
    if (sig) {
      const expected = crypto
        .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
        .update(JSON.stringify(body))
        .digest('hex');
      if (sig !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }
  }

  const {
    checkout_id, phone, name, email,
    program, amount, status: paymentStatus
  } = body;

  if (!phone || paymentStatus !== 'paid') {
    return res.status(200).json({ action: 'ignored', reason: 'not_paid_or_no_phone' });
  }

  const db = getSupabase();

  const lead = await db.from('leads').select('*').eq('phone', phone).single();
  const leadId = lead.data?.id || null;

  if (leadId) {
    await db.from('leads').update({ status: 'converted' }).eq('id', leadId);
  }

  const programKey = program || lead.data?.program_interest || '6wk_gym';
  const durationWeeks = PROGRAM_DURATIONS_WEEKS[programKey] || 6;
  const programStart = new Date();
  const programEnd = new Date();
  programEnd.setDate(programEnd.getDate() + durationWeeks * 7);

  const { data: client, error } = await db.from('clients').upsert({
    lead_id: leadId,
    phone,
    name: name || lead.data?.name,
    email,
    program: programKey,
    program_started_at: programStart.toISOString(),
    program_ends_at: programEnd.toISOString(),
    paid_amount: amount ? parseInt(amount) : null,
    checkout_id: checkout_id || null,
    folder_url: null,
    status: 'active'
  }, { onConflict: 'phone' }).select().single();

  if (error) {
    return res.status(500).json({ error: 'Failed to create client' });
  }

  const folderPath = `${client.id}/`;
  await db.storage.from('clients').upload(
    `${folderPath}.keep`,
    Buffer.from(''),
    { contentType: 'text/plain', upsert: true }
  );

  const programName = PROGRAM_NAMES[programKey] || programKey;
  const welcomeMsg =
    `Welcome to ${programName}! \u{1F389}\n\n` +
    `Your program starts today and runs for ${durationWeeks} weeks.\n\n` +
    `Your first check-in form will be sent on Day 7. ` +
    `Make sure to fill it out so we can track your progress!\n\n` +
    `Let's crush this! \u{1F4AA}\n\n` +
    `— Team Maddy`;

  await sendWhatsApp(phone, welcomeMsg, `onboard_${programKey}`);

  if (programKey === '12wk') {
    try {
      const origin = `https://${req.headers.host}`;
      await fetch(`${origin}/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`
        },
        body: JSON.stringify({ client_id: client.id, week_no: 1 })
      });
    } catch (_) {
      // async — failures handled in generate-program
    }
  }

  return res.status(200).json({ success: true, client_id: client.id });
};
