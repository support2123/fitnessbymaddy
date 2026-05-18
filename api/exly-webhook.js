const crypto = require('crypto');
const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp, notifyMaddy } = require('./_lib/whatsapp');
const { maskPhone, jsonResponse, errorResponse } = require('./_lib/utils');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return errorResponse(res, 'POST only', 405);

  if (process.env.EXLY_WEBHOOK_SECRET) {
    const sig = req.headers['x-exly-signature'] || '';
    const raw = JSON.stringify(req.body);
    const expected = crypto
      .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
      .update(raw)
      .digest('hex');
    if (sig && sig !== expected) {
      return errorResponse(res, 'Invalid signature', 403);
    }
  }

  const payload = req.body || {};
  const phone = payload.phone || payload.customer_phone;
  const email = payload.email || payload.customer_email;
  const name = payload.name || payload.customer_name;
  const checkoutId = payload.checkout_id || payload.order_id;
  const amount = payload.amount || payload.paid_amount || 0;
  const productName = (payload.product_name || payload.product || '').toLowerCase();

  if (!phone) return errorResponse(res, 'No phone in payload');

  const db = getSupabase();

  const program = mapExlyProduct(productName);

  const { data: lead } = await db
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .maybeSingle();

  const leadId = lead?.id || null;

  if (lead) {
    await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
  }

  const programEndWeeks = program.startsWith('12wk') ? 12 : 6;
  const endsAt = new Date();
  endsAt.setDate(endsAt.getDate() + programEndWeeks * 7);

  const { data: client } = await db.from('clients').insert({
    lead_id: leadId,
    phone,
    name,
    email,
    program,
    program_started_at: new Date().toISOString(),
    program_ends_at: endsAt.toISOString(),
    paid_amount: Math.round(amount * 100),
    checkout_id: checkoutId,
    folder_url: null,
    status: 'active',
  }).select().single();

  const folderPath = `clients/${client.id}`;
  await db.storage.from('clients').upload(`${folderPath}/.keep`, new Uint8Array(0), {
    upsert: true,
  });

  await db.from('clients').update({ folder_url: folderPath }).eq('id', client.id);

  const templateName = `onboard_${program}`;
  await sendWhatsApp(phone, templateName, [name || 'there']);

  if (program === '12wk') {
    try {
      await fetch(`https://www.fitnessbymaddy.com/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.CRON_SECRET}`,
        },
        body: JSON.stringify({ client_id: client.id, week_no: 1 }),
      });
    } catch (err) {
      console.error('Auto program generation failed:', err.message);
    }
  }

  console.log(`Converted: ${maskPhone(phone)} → ${program}`);
  return jsonResponse(res, { ok: true, client_id: client.id, program });
};

function mapExlyProduct(name) {
  if (/pcos/i.test(name)) return 'pcos';
  if (/40\+|forty/i.test(name)) return '40plus';
  if (/12.?week|custom|flagship/i.test(name)) return '12wk';
  if (/zoom.?pack/i.test(name)) return 'zoom_pack';
  if (/zoom|trial/i.test(name)) return 'zoom_trial';
  if (/home/i.test(name)) return '6wk_home';
  return '6wk_gym';
}
