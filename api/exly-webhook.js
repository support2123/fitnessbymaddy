const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { json, cors, parseProgramDuration } = require('../lib/helpers');
const { getProgramBySlug } = require('../lib/qualify');

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return json(res, { error: 'POST only' }, 405);

  const db = getSupabase();

  try {
    const secret = req.headers['x-exly-secret'] || req.body.webhook_secret;
    if (process.env.EXLY_WEBHOOK_SECRET && secret !== process.env.EXLY_WEBHOOK_SECRET) {
      return json(res, { error: 'Unauthorized' }, 401);
    }

    const {
      phone,
      email,
      name,
      checkout_id,
      program,
      amount,
    } = req.body;

    if (!phone || !program) {
      return json(res, { error: 'phone and program required' }, 400);
    }

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (lead) {
      await db
        .from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const durationDays = parseProgramDuration(program);
    const programEnds = new Date(
      Date.now() + durationDays * 24 * 60 * 60 * 1000
    ).toISOString();

    const { data: client, error: clientErr } = await db
      .from('clients')
      .insert({
        lead_id: lead ? lead.id : null,
        phone,
        name: name || (lead ? lead.name : null),
        email,
        program,
        paid_amount: amount ? parseInt(amount, 10) : 0,
        checkout_id,
        program_started_at: new Date().toISOString(),
        program_ends_at: programEnds,
        status: 'active',
        goal: lead ? lead.program_interest : null,
      })
      .select()
      .single();

    if (clientErr) {
      console.error('Client creation error:', clientErr.message);
      return json(res, { error: 'Failed to create client' }, 500);
    }

    const folderPath = `clients/${client.id}`;
    await db.storage.from('programs').upload(`${folderPath}/.keep`, new Blob(['']));

    await db
      .from('clients')
      .update({ folder_url: folderPath })
      .eq('id', client.id);

    const programInfo = getProgramBySlug(program);
    const label = programInfo ? programInfo.label : program;

    await sendWhatsApp(phone, `onboard_${program}`, [
      client.name || 'there',
      label,
    ]);

    if (program === '12wk') {
      const siteUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : process.env.SITE_URL || 'https://fitnessbymaddy.com';

      fetch(`${siteUrl}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: client.id, week_no: 1 }),
      }).catch((err) =>
        console.error('Week-1 program trigger failed:', err.message)
      );
    }

    return json(res, {
      action: 'client_created',
      client_id: client.id,
      program,
    });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return json(res, { error: 'Internal error' }, 500);
  }
};
