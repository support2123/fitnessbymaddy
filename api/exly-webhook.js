const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, sendEscalation, maskPhone } = require('../lib/whatsapp');
const { programDurationWeeks, PROGRAM_NAMES } = require('../lib/helpers');
const crypto = require('crypto');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

  try {
    if (process.env.EXLY_WEBHOOK_SECRET) {
      const sig = req.headers['x-exly-signature'] || '';
      const expected = crypto
        .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (sig !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const {
      phone, name, email, program, amount,
      checkout_id, status: paymentStatus,
    } = parseExlyPayload(req.body);

    if (!phone || !program) {
      return res.status(400).json({ error: 'Missing phone or program' });
    }

    if (paymentStatus === 'failed') {
      await sendEscalation(
        `Payment FAILED for ${maskPhone(phone)}, program: ${program}, amount: ${amount}. Follow up needed.`
      );
      return res.status(200).json({ action: 'payment_failed_flagged' });
    }

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (lead) {
      await db.from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const durationWeeks = programDurationWeeks(program);
    const programStart = new Date();
    const programEnd = new Date(programStart.getTime() + durationWeeks * 7 * 24 * 60 * 60 * 1000);

    const { data: client } = await db.from('clients').insert({
      lead_id: lead?.id || null,
      phone,
      name: name || lead?.name || null,
      email: email || null,
      program,
      program_started_at: programStart.toISOString(),
      program_ends_at: programEnd.toISOString(),
      paid_amount: amount ? parseInt(amount) : null,
      checkout_id: checkout_id || null,
      folder_url: null,
      status: 'active',
    }).select().single();

    try {
      const folderPath = `clients/${client.id}`;
      await db.storage
        .from('programs')
        .upload(`${folderPath}/.keep`, new Uint8Array(0), {
          contentType: 'application/octet-stream',
          upsert: true,
        });
      await db.from('clients')
        .update({ folder_url: folderPath })
        .eq('id', client.id);
    } catch (storageErr) {
      console.error('Storage folder creation:', storageErr.message);
    }

    const programName = PROGRAM_NAMES[program] || program;
    await sendWhatsApp({
      phone,
      body: `Welcome to ${programName}! 🎉\n\nYou're officially in. Here's what happens next:\n\n1️⃣ Your program starts now\n2️⃣ First check-in form arrives on Day 7\n3️⃣ Stay consistent — we've got your back!\n\nLet's do this 💪`,
    });

    if (program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://fitnessbymaddy.com';
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch (e) {
        console.error('Week 1 program generation trigger failed:', e.message);
      }
    }

    return res.status(200).json({ ok: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function parseExlyPayload(body) {
  return {
    phone: (body.phone || body.customer_phone || body.mobile || '').replace(/\D/g, ''),
    name: body.name || body.customer_name || null,
    email: body.email || body.customer_email || null,
    program: body.program || body.product_id || body.plan || null,
    amount: body.amount || body.total_amount || null,
    checkout_id: body.checkout_id || body.order_id || body.transaction_id || null,
    status: body.status || body.payment_status || 'success',
  };
}
