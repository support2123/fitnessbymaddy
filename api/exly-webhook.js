const crypto = require('crypto');
const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { programDurationWeeks, sendJson, sendError, corsHeaders } = require('../lib/utils');

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return sendError(res, 405, 'POST only');

  if (process.env.EXLY_WEBHOOK_SECRET) {
    const sig = req.headers['x-exly-signature'] || '';
    const expected = crypto
      .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
      .update(JSON.stringify(req.body))
      .digest('hex');
    if (sig !== expected) {
      return sendError(res, 403, 'Invalid signature');
    }
  }

  const {
    phone, email, name, program, amount,
    checkout_id, order_id
  } = req.body || {};

  if (!phone || !program) {
    return sendError(res, 400, 'Missing phone or program');
  }

  const db = getSupabase();

  const { data: lead } = await db
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .limit(1)
    .single();

  let leadId = lead?.id;

  if (!lead) {
    const { data: newLead } = await db.from('leads').insert({
      phone,
      name: name || null,
      source: 'exly',
      status: 'converted',
      program_interest: program,
    }).select().single();
    leadId = newLead.id;
  } else {
    await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
  }

  const weeks = programDurationWeeks(program);
  const startsAt = new Date();
  const endsAt = new Date(startsAt.getTime() + weeks * 7 * 24 * 60 * 60 * 1000);

  const { data: client } = await db.from('clients').insert({
    lead_id: leadId,
    phone,
    name: name || lead?.name || null,
    email: email || null,
    program,
    program_started_at: startsAt.toISOString(),
    program_ends_at: endsAt.toISOString(),
    paid_amount: amount || null,
    checkout_id: checkout_id || order_id || null,
    folder_url: null,
    status: 'active',
  }).select().single();

  const folderPath = `clients/${client.id}`;
  await db.storage.from('programs').upload(
    `${folderPath}/.keep`,
    new Uint8Array(0),
    { contentType: 'text/plain', upsert: true }
  );

  await db.from('clients').update({
    folder_url: folderPath,
  }).eq('id', client.id);

  await sendWhatsApp(phone, `onboard_${program}`, [
    name || 'Champion',
    `${weeks} weeks`,
  ]);

  if (program === '12wk') {
    try {
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'https://fitnessbymaddy.com';

      await fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`,
        },
        body: JSON.stringify({ client_id: client.id, week_no: 1 }),
      });
    } catch (err) {
      console.error('Failed to trigger Week-1 program generation:', err.message);
    }
  }

  return sendJson(res, 200, { success: true, client_id: client.id });
};
