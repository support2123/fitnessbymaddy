const { supabase } = require('./_lib/supabase');
const { sendTemplate } = require('./_lib/whatsapp');
const { programWeeks, cors, parseBody, maskPhone } = require('./_lib/utils');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = await parseBody(req);

    const secret = req.headers['x-exly-secret'] || body.webhook_secret;
    if (process.env.EXLY_WEBHOOK_SECRET && secret !== process.env.EXLY_WEBHOOK_SECRET) {
      return res.status(401).json({ error: 'Invalid webhook secret' });
    }

    const phone = body.phone || body.customer_phone;
    const email = body.email || body.customer_email;
    const name = body.name || body.customer_name;
    const checkoutId = body.checkout_id || body.order_id;
    const amount = body.amount || body.paid_amount || 0;

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!lead) {
      console.error('Exly webhook: no lead for', maskPhone(phone));
      return res.status(404).json({ error: 'Lead not found' });
    }

    const program = lead.program_interest || '6wk_gym';
    const weeks = programWeeks(program);
    const endsAt = new Date();
    endsAt.setDate(endsAt.getDate() + weeks * 7);

    await supabase.from('leads')
      .update({ status: 'converted' })
      .eq('id', lead.id);

    const { data: client } = await supabase.from('clients').insert({
      lead_id: lead.id,
      phone,
      name: name || lead.name,
      email,
      program,
      program_started_at: new Date().toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: parseInt(amount),
      checkout_id: checkoutId,
      folder_url: `/clients/${lead.id}/`,
      status: 'active',
    }).select().single();

    await sendTemplate(phone, `onboard_${program}`, [
      client.name || 'there',
      `https://fitnessbymaddy.com/checkin?c=${client.id}&w=1`,
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
        console.error('Failed to trigger Week 1 generation:', e.message);
      }
    }

    return res.json({ ok: true, client_id: client.id });
  } catch (err) {
    console.error('exly-webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
