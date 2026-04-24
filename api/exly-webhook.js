const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { json, cors, programDurationWeeks, PROGRAM_PRICES } = require('../lib/utils');
const crypto = require('crypto');

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return json(res, { error: 'POST only' }, 405);

  const db = getSupabase();

  try {
    const signature = req.headers['x-exly-signature'];
    if (process.env.EXLY_WEBHOOK_SECRET && signature) {
      const expected = crypto
        .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (signature !== expected) {
        return json(res, { error: 'Invalid signature' }, 401);
      }
    }

    const {
      checkout_id,
      phone,
      email,
      name,
      amount,
      product_name,
      status: paymentStatus,
    } = req.body || {};

    if (!phone) return json(res, { error: 'No phone' }, 400);
    if (paymentStatus && paymentStatus !== 'paid') {
      if (paymentStatus === 'failed') {
        await db.from('escalations').insert({
          phone,
          reason: `Payment failed for ${product_name || 'unknown'} (${checkout_id})`,
        });
      }
      return json(res, { action: 'payment_not_completed', status: paymentStatus });
    }

    const program = detectProgramFromProduct(product_name, checkout_id);
    const durationWeeks = programDurationWeeks(program);
    const startDate = new Date();
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + durationWeeks * 7);

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .limit(1)
      .single();

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const { data: client, error } = await db
      .from('clients')
      .insert({
        lead_id: lead ? lead.id : null,
        phone,
        name: name || (lead ? lead.name : null),
        email,
        program,
        program_started_at: startDate.toISOString(),
        program_ends_at: endDate.toISOString(),
        paid_amount: amount || PROGRAM_PRICES[program] || 0,
        checkout_id,
        folder_url: null,
        status: 'active',
      })
      .select()
      .single();

    if (error) throw error;

    await sendWhatsApp(phone, `onboard_${program}`, [
      client.name || 'there',
      durationWeeks.toString(),
    ]);

    if (program === '12wk') {
      try {
        const origin = `https://${req.headers.host || 'fitnessbymaddy.com'}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch (e) {
        console.error('Week-1 program generation failed:', e.message);
      }
    }

    return json(res, { ok: true, client_id: client.id, program });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return json(res, { error: 'Internal error' }, 500);
  }
};

function detectProgramFromProduct(productName, checkoutId) {
  const lower = (productName || checkoutId || '').toLowerCase();
  if (/pcos/i.test(lower)) return 'pcos';
  if (/40\+|40plus|forty/i.test(lower)) return '40plus';
  if (/12.?week|custom|flagship/i.test(lower)) return '12wk';
  if (/home/i.test(lower)) return '6wk_home';
  if (/trial/i.test(lower)) return 'zoom_trial';
  if (/zoom.?pack/i.test(lower)) return 'zoom_pack';
  return '6wk_gym';
}
