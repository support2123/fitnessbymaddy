const { getSupabase } = require('./lib/supabase');
const { sendAndLog } = require('./lib/whatsapp');
const { maskPhone, programDurationWeeks, jsonResponse } = require('./lib/utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secret = req.headers['x-webhook-secret'] || req.headers['x-exly-secret'];
  if (secret !== process.env.EXLY_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const body = req.body;
    const phone = body.phone || body.customer_phone || '';
    const email = body.email || body.customer_email || '';
    const name = body.name || body.customer_name || '';
    const checkoutId = body.checkout_id || body.order_id || '';
    const amount = body.amount || body.paid_amount || 0;

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone' });
    }

    const db = getSupabase();

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!lead) {
      console.error(`Exly webhook: no lead for ${maskPhone(phone)}`);
      return res.status(404).json({ error: 'Lead not found' });
    }

    const program = lead.program_interest || '6wk_gym';
    const durationWeeks = programDurationWeeks(program);
    const now = new Date();
    const endsAt = new Date(now.getTime() + durationWeeks * 7 * 24 * 60 * 60 * 1000);

    await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);

    const { data: client } = await db.from('clients').insert({
      lead_id: lead.id,
      phone,
      name: name || lead.name,
      email,
      program,
      program_started_at: now.toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: amount,
      checkout_id: checkoutId,
      folder_url: `/clients/${lead.id}/`,
      status: 'active',
    }).select().single();

    const onboardTemplate = `onboard_${program}`;
    await sendAndLog(phone, onboardTemplate, [
      name || lead.name || 'there',
      `${durationWeeks} weeks`,
    ], true);

    if (program === '12wk') {
      try {
        const origin = req.headers['x-forwarded-host']
          ? `https://${req.headers['x-forwarded-host']}`
          : 'https://www.fitnessbymaddy.com';
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch (e) {
        console.error('Failed to trigger program generation:', e.message);
      }
    }

    console.log(`Converted: ${maskPhone(phone)} → ${program}`);
    return res.status(200).json({ action: 'converted', client_id: client.id });

  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
