const crypto = require('crypto');
const { getSupabase } = require('../lib/supabase');
const { sendTemplate, detectMarket } = require('../lib/whatsapp');
const { jsonResponse, errorResponse, handleOptions, normalizePhone, PROGRAM_DURATIONS_WEEKS } = require('../lib/utils');

function verifySignature(payload, signature) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature || ''), Buffer.from(expected));
}

module.exports = async function handler(req) {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return errorResponse('Method not allowed', 405);

  try {
    const rawBody = await req.text();
    const signature = req.headers.get('x-exly-signature');

    if (process.env.EXLY_WEBHOOK_SECRET && !verifySignature(rawBody, signature)) {
      return errorResponse('Invalid signature', 401);
    }

    const body = JSON.parse(rawBody);
    const phone = normalizePhone(body.phone || body.customer_phone || '');
    const email = body.email || body.customer_email || null;
    const name = body.name || body.customer_name || null;
    const checkoutId = body.checkout_id || body.order_id || null;
    const amount = body.amount || body.paid_amount || 0;
    const programSlug = body.program || body.product_name || null;

    if (!phone) return errorResponse('Missing phone');

    const db = getSupabase();

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!lead) {
      await db.from('leads').insert({
        phone, name, source: 'exly',
        status: 'converted',
        market: detectMarket(phone)
      });
    } else {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const program = lead?.program_interest || programSlug || '6wk_gym';
    const durationWeeks = PROGRAM_DURATIONS_WEEKS[program] || 6;
    const now = new Date();
    const endsAt = new Date(now.getTime() + durationWeeks * 7 * 24 * 60 * 60 * 1000);

    const { data: client } = await db.from('clients').insert({
      lead_id: lead?.id || null,
      phone,
      name: name || lead?.name,
      email,
      program,
      program_started_at: now.toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: amount,
      checkout_id: checkoutId,
      status: 'active'
    }).select().single();

    const folderPath = `clients/${client.id}`;
    await db.from('clients').update({ folder_url: folderPath }).eq('id', client.id);

    const market = lead?.market || detectMarket(phone);
    const templateName = `onboard_${program}`;

    await sendTemplate(phone, templateName, [
      name || 'there',
      durationWeeks.toString()
    ]);

    return jsonResponse({ ok: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return errorResponse('Internal error', 500);
  }
};
