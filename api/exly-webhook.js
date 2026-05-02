const { getSupabase } = require('./_lib/supabase');
const { sendTemplate, notifyMaddy } = require('./_lib/whatsapp');
const { handleCors, maskPhone, programWeeks, programDisplayName } = require('./_lib/utils');
const crypto = require('crypto');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const signature = req.headers['x-webhook-signature'] || req.headers['x-exly-signature'];
    if (process.env.EXLY_WEBHOOK_SECRET && signature) {
      const expected = crypto
        .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
        .update(JSON.stringify(req.body))
        .digest('hex');

      if (signature !== expected) {
        console.error('Exly webhook signature mismatch');
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const payload = req.body;
    const phone = payload.phone || payload.customer_phone || payload.mobile;
    const email = payload.email || payload.customer_email;
    const name = payload.name || payload.customer_name;
    const amount = payload.amount || payload.paid_amount;
    const checkoutId = payload.checkout_id || payload.order_id || payload.transaction_id;
    const programCode = payload.program || payload.product_code;

    if (!phone) {
      return res.status(400).json({ error: 'Phone number required' });
    }

    const db = getSupabase();

    let { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!lead) {
      const { data: newLead } = await db.from('leads').insert({
        phone,
        name,
        source: 'exly_purchase',
        status: 'converted',
        program_interest: programCode
      }).select().single();
      lead = newLead;
    } else {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const program = programCode || lead.program_interest || '6wk_gym';
    const weeks = programWeeks(program);
    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + weeks * 7 * 24 * 60 * 60 * 1000);

    const { data: existingClient } = await db
      .from('clients')
      .select('id')
      .eq('phone', phone)
      .single();

    let clientId;

    if (existingClient) {
      await db.from('clients').update({
        name: name || undefined,
        email: email || undefined,
        program,
        program_started_at: startDate.toISOString(),
        program_ends_at: endDate.toISOString(),
        paid_amount: amount ? parseInt(amount) : undefined,
        checkout_id: checkoutId,
        status: 'active'
      }).eq('id', existingClient.id);
      clientId = existingClient.id;
    } else {
      const { data: newClient } = await db.from('clients').insert({
        lead_id: lead.id,
        phone,
        name,
        email,
        program,
        program_started_at: startDate.toISOString(),
        program_ends_at: endDate.toISOString(),
        paid_amount: amount ? parseInt(amount) : null,
        checkout_id: checkoutId,
        status: 'active'
      }).select().single();
      clientId = newClient.id;
    }

    const folderPath = `${clientId}/`;
    await db.storage.from('clients').upload(
      `${folderPath}.keep`,
      Buffer.from(''),
      { contentType: 'text/plain', upsert: true }
    );

    await db.from('clients').update({
      folder_url: `clients/${folderPath}`
    }).eq('id', clientId);

    const templateName = `onboard_${program}`;
    await sendTemplate(phone, templateName, [
      name || 'there',
      programDisplayName(program),
      `Week 1 of ${weeks}`
    ]);

    if (program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://fitnessbymaddy.com';

        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: clientId, week_no: 1 })
        });
      } catch (e) {
        console.error('Initial program generation failed:', e.message);
      }
    }

    console.log(`Conversion: ${maskPhone(phone)} → ${program} ($${amount})`);
    return res.status(200).json({ ok: true, client_id: clientId });

  } catch (err) {
    console.error('Exly webhook error:', err.message);

    if (req.body?.phone) {
      await notifyMaddy(
        'Payment webhook processing failed',
        `Phone: ${maskPhone(req.body.phone)}\nError: ${err.message}`
      );
    }

    return res.status(500).json({ error: 'Internal error' });
  }
};
