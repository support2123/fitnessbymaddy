const crypto = require('crypto');
const { getSupabase } = require('./lib/supabase');
const { sendTemplate, notifyMaddy } = require('./lib/whatsapp');
const { detectMarket, isHinglish, maskPhone, parseBody, corsHeaders, json } = require('./lib/utils');

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return json(res, { error: 'POST only' }, 405);

  try {
    const body = await parseBody(req);

    const secret = process.env.EXLY_WEBHOOK_SECRET;
    if (secret && body._signature) {
      const expected = crypto
        .createHmac('sha256', secret)
        .update(JSON.stringify(body))
        .digest('hex');
      if (body._signature !== expected) {
        return json(res, { error: 'invalid signature' }, 401);
      }
    }

    const phone = body.phone || body.mobile || body.customer_phone;
    const email = body.email || body.customer_email;
    const name = body.name || body.customer_name;
    const program = body.product_id || body.program || body.plan;
    const amount = body.amount || body.paid_amount;
    const checkoutId = body.checkout_id || body.order_id || body.transaction_id;

    if (!phone) return json(res, { error: 'missing phone' }, 400);

    const sb = getSupabase();

    const { data: lead } = await sb
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    const leadId = lead?.id || null;
    if (lead) {
      await sb.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const programWeeks = {
      '6wk_gym': 6, '6wk_home': 6,
      '12wk': 12, 'pcos': 6,
      '40plus': 8, 'zoom_trial': 1, 'zoom_pack': 4
    };
    const weeks = programWeeks[program] || 6;
    const endsAt = new Date();
    endsAt.setDate(endsAt.getDate() + weeks * 7);

    const folderPath = `clients/${checkoutId || Date.now()}`;

    const { data: client, error } = await sb.from('clients').insert({
      lead_id: leadId,
      phone,
      name,
      email,
      program: program || '6wk_gym',
      program_started_at: new Date().toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: amount ? parseInt(amount) : null,
      checkout_id: checkoutId,
      folder_url: folderPath,
      status: 'active'
    }).select().single();

    if (error) {
      console.error('Client insert error:', error.message);
      return json(res, { error: 'save failed' }, 500);
    }

    const market = lead?.market || detectMarket(phone);
    const templateName = isHinglish(market) ? `onboard_${program}` : `onboard_${program}_en`;
    await sendTemplate(phone, templateName, [name || 'Champion'], true);

    if (program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://www.fitnessbymaddy.com';
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (err) {
        console.error('Week-1 program gen failed:', err.message);
      }
    }

    return json(res, { ok: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return json(res, { error: 'internal' }, 500);
  }
};
