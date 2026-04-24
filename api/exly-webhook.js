const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { escalateToMaddy } = require('../lib/escalate');
const { corsHeaders } = require('../lib/utils');
const crypto = require('crypto');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders());
    return res.end();
  }

  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Method not allowed' }));
  }

  try {
    const rawBody =
      typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

    if (process.env.EXLY_WEBHOOK_SECRET) {
      const signature = req.headers['x-exly-signature'];
      const expected = crypto
        .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
        .update(rawBody)
        .digest('hex');
      if (signature && signature !== expected) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Invalid signature' }));
      }
    }

    const phone = body.phone || body.customer_phone;
    const email = body.email || body.customer_email;
    const name = body.name || body.customer_name;
    const amount = body.amount || body.paid_amount || 0;
    const checkoutId = body.checkout_id || body.order_id || body.id;
    const productSlug = body.product_slug || body.product || '';

    if (!phone) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'phone required' }));
    }

    const programMap = {
      '6wk-burn-build-gym': '6wk_gym',
      '6wk-burn-build-home': '6wk_home',
      'pcos-warrior': 'pcos',
      '40plus-strong': '40plus',
      '12wk-flagship': '12wk',
      'zoom-trial': 'zoom_trial',
      'zoom-4pack': 'zoom_pack',
    };

    const program = programMap[productSlug] || '6wk_gym';

    const db = getSupabase();

    let leadId = null;
    const { data: lead } = await db
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .single();

    if (lead) {
      leadId = lead.id;
      await db
        .from('leads')
        .update({ status: 'converted', program_interest: program })
        .eq('id', lead.id);
    }

    const programDays = program === '12wk' ? 84 : 42;
    const endsAt = new Date(
      Date.now() + programDays * 24 * 60 * 60 * 1000
    ).toISOString();

    const { data: client, error } = await db
      .from('clients')
      .insert({
        lead_id: leadId,
        phone,
        name,
        email,
        program,
        program_started_at: new Date().toISOString(),
        program_ends_at: endsAt,
        paid_amount: Math.round(amount * 100),
        checkout_id: checkoutId,
        folder_url: null,
        status: 'active',
      })
      .select()
      .single();

    if (error) {
      console.error('Client creation failed:', error.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Failed to create client' }));
    }

    const folderPath = `clients/${client.id}`;
    await db.storage
      .from('programs')
      .upload(`${folderPath}/.keep`, new Uint8Array(0), {
        contentType: 'text/plain',
        upsert: true,
      });

    await db
      .from('clients')
      .update({ folder_url: folderPath })
      .eq('id', client.id);

    await sendWhatsApp({
      phone,
      templateName: `onboard_${program}`,
      bodyValues: [name || 'there'],
    });

    if (program === '12wk') {
      try {
        const origin = `https://${req.headers.host || 'fitnessbymaddy.com'}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.INTERNAL_API_KEY}`,
          },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch (e) {
        console.error('Week 1 program generation failed:', e.message);
      }
    }

    res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders() });
    return res.end(
      JSON.stringify({ ok: true, client_id: client.id, program })
    );
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    await escalateToMaddy({
      reason: 'Payment webhook processing failed',
      phone: 'system',
      details: err.message,
    }).catch(() => {});
    res.writeHead(500, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};
