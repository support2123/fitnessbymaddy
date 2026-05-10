const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { detectMarket, parseBody, jsonResp, corsHeaders } = require('../lib/helpers');
const { escalateToMaddy } = require('../lib/escalate');
const crypto = require('crypto');

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return jsonResp(res, 405, { error: 'Method not allowed' });

  const db = getSupabase();
  let body;
  try {
    body = await parseBody(req);
  } catch {
    return jsonResp(res, 400, { error: 'Invalid request body' });
  }

  if (process.env.EXLY_WEBHOOK_SECRET) {
    const signature = req.headers['x-exly-signature'] || '';
    const expected = crypto
      .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
      .update(JSON.stringify(body))
      .digest('hex');
    if (signature !== expected) {
      return jsonResp(res, 401, { error: 'Invalid signature' });
    }
  }

  const event = body.event || body.type || '';
  if (event === 'payment.failed') {
    await escalateToMaddy('Payment failure', {
      phone: body.customer?.phone || '',
      name: body.customer?.name || '',
      message: `Payment failed for order ${body.order_id || 'unknown'}`,
    });
    return jsonResp(res, 200, { action: 'payment_failure_escalated' });
  }

  if (event !== 'payment.success' && event !== 'order.completed') {
    return jsonResp(res, 200, { action: 'ignored', event });
  }

  const phone = body.customer?.phone || body.phone || '';
  const email = body.customer?.email || body.email || '';
  const name = body.customer?.name || body.name || '';
  const amount = body.amount || body.total || 0;
  const checkoutId = body.order_id || body.checkout_id || '';
  const productName = (body.product?.name || body.item_name || '').toLowerCase();

  let program = '6wk_gym';
  if (productName.includes('12') || productName.includes('custom') || productName.includes('flagship')) {
    program = '12wk';
  } else if (productName.includes('pcos')) {
    program = 'pcos';
  } else if (productName.includes('40') || productName.includes('strong')) {
    program = '40plus';
  } else if (productName.includes('trial') || productName.includes('zoom')) {
    program = 'zoom_trial';
  } else if (productName.includes('home')) {
    program = '6wk_home';
  }

  const { data: lead } = await db
    .from('leads')
    .select('id, program_interest')
    .eq('phone', phone)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (lead?.program_interest) {
    program = lead.program_interest;
  }

  if (lead) {
    await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
  }

  const programStartedAt = new Date();
  const weeksMap = { '6wk_gym': 6, '6wk_home': 6, '12wk': 12, 'pcos': 6, '40plus': 8, 'zoom_trial': 1, 'zoom_pack': 4 };
  const weeks = weeksMap[program] || 6;
  const programEndsAt = new Date(programStartedAt.getTime() + weeks * 7 * 24 * 60 * 60 * 1000);

  const { data: client, error } = await db.from('clients').insert({
    lead_id: lead?.id || null,
    phone,
    name,
    email,
    program,
    program_started_at: programStartedAt.toISOString(),
    program_ends_at: programEndsAt.toISOString(),
    paid_amount: amount,
    checkout_id: checkoutId,
    status: 'active',
  }).select().single();

  if (error) {
    console.error('Client insert error:', error.message);
    return jsonResp(res, 500, { error: 'Failed to create client' });
  }

  await db.storage
    .from('client-files')
    .upload(`clients/${client.id}/.keep`, new Uint8Array(0), { upsert: true });

  const market = detectMarket(phone);
  const template = market === 'IN' ? `onboard_${program}_hi` : `onboard_${program}_en`;
  await sendWhatsApp(phone, template, [name || 'there']);

  if (program === '12wk') {
    try {
      const baseUrl = `https://${req.headers.host}`;
      await fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: client.id, week_no: 1 }),
      });
    } catch (e) {
      console.error('Week 1 program generation failed:', e.message);
    }
  }

  return jsonResp(res, 200, {
    action: 'converted',
    client_id: client.id,
    program,
  });
};
