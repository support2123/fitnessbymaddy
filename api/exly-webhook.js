const crypto = require('crypto');
const { getClient } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { programLabel } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const secret = process.env.EXLY_WEBHOOK_SECRET;
    if (secret) {
      const sig = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'];
      if (sig) {
        const expected = crypto
          .createHmac('sha256', secret)
          .update(JSON.stringify(req.body))
          .digest('hex');
        if (sig !== expected) {
          return res.status(401).json({ error: 'Invalid signature' });
        }
      }
    }

    const body = req.body;
    const phone = body.phone || body.customer_phone;
    const email = body.email || body.customer_email;
    const name = body.name || body.customer_name;
    const checkoutId = body.checkout_id || body.order_id;
    const amount = body.amount || body.paid_amount || 0;

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone' });
    }

    const db = getClient();

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (lead) {
      await db
        .from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const program = lead?.program_interest || body.program || '6wk_gym';

    const durationWeeks = program === '12wk' ? 12 : 6;
    const endsAt = new Date();
    endsAt.setDate(endsAt.getDate() + durationWeeks * 7);

    const { data: client } = await db
      .from('clients')
      .upsert(
        {
          lead_id: lead?.id || null,
          phone,
          name: name || lead?.name,
          email,
          program,
          paid_amount: Math.round(amount),
          checkout_id: checkoutId,
          status: 'active',
          program_started_at: new Date().toISOString(),
          program_ends_at: endsAt.toISOString(),
        },
        { onConflict: 'phone' }
      )
      .select()
      .single();

    if (client) {
      const folderPath = `clients/${client.id}`;
      await db.storage.from('clients').upload(`${folderPath}/.keep`, new Blob(['']));

      await db
        .from('clients')
        .update({ folder_url: folderPath })
        .eq('id', client.id);
    }

    const label = programLabel(program);
    await sendTemplate(phone, `onboard_${program}`, [name || 'there', label]);

    if (program === '12wk' && client) {
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
        console.error('Week-1 program generation failed:', e.message);
      }
    }

    return res.status(200).json({ ok: true, client_id: client?.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
