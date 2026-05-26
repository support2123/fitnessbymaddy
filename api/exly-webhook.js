const { getSupabase } = require('../lib/supabase');
const { sendWhatsAppForced } = require('../lib/whatsapp');
const { isHinglish } = require('../lib/market');
const { PROGRAMS } = require('../lib/constants');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const secret = req.headers['x-webhook-secret'] || req.headers['x-exly-secret'];
    if (process.env.EXLY_WEBHOOK_SECRET && secret !== process.env.EXLY_WEBHOOK_SECRET) {
      return res.status(401).json({ error: 'Invalid webhook secret' });
    }

    const {
      phone, email, name, checkout_id,
      amount, program,
    } = parseExlyPayload(req.body);

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    const db = getSupabase();

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const programKey = program || lead?.program_interest || '6wk_gym';
    const prog = PROGRAMS[programKey] || PROGRAMS['6wk_gym'];
    const endsAt = new Date();
    endsAt.setDate(endsAt.getDate() + prog.weeks * 7);

    const { data: client, error: insertErr } = await db.from('clients').insert({
      lead_id: lead?.id || null,
      phone,
      name: name || lead?.name || null,
      email: email || null,
      program: programKey,
      program_ends_at: endsAt.toISOString(),
      paid_amount: amount || prog.price,
      checkout_id: checkout_id || null,
      folder_url: null,
      status: 'active',
    }).select().single();

    if (insertErr) {
      console.error('Client insert error:', insertErr.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    const folderUrl = `/clients/${client.id}/`;
    await db.from('clients').update({ folder_url: folderUrl }).eq('id', client.id);

    const hinglish = isHinglish(lead?.market || 'GLOBAL');
    const welcomeMsg = hinglish
      ? `Welcome to the ${prog.name} family! Tumhara program start ho gaya hai. Pehla check-in Day 7 pe aayega. Questions ho toh yahan message karo!`
      : `Welcome to the ${prog.name} family! Your program starts now. Your first check-in will be on Day 7. Message us here with any questions!`;

    await sendWhatsAppForced(phone, welcomeMsg, `onboard_${programKey}`);

    if (programKey === '12wk') {
      try {
        const baseUrl = `https://${req.headers.host}`;
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch (genErr) {
        console.error('Week-1 program generation trigger failed:', genErr.message);
      }
    }

    return res.json({ success: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function parseExlyPayload(body) {
  if (!body) return {};
  return {
    phone: body.phone || body.mobile || body.customer_phone,
    email: body.email || body.customer_email,
    name: body.name || body.customer_name,
    checkout_id: body.checkout_id || body.order_id || body.transaction_id,
    amount: body.amount || body.total,
    program: body.program || body.product_name || null,
  };
}
