const { getSupabase } = require('../lib/supabase');
const { sendTemplate, detectMarket, isHinglish } = require('../lib/whatsapp');
const { parseBody, json, cors, verifyExlySignature } = require('../lib/utils');

const PROGRAM_DURATIONS = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 30,
};

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return json(res, 200, { ok: true });
  if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });

  const body = await parseBody(req);
  const signature = req.headers['x-exly-signature'] || '';

  if (process.env.EXLY_WEBHOOK_SECRET && !verifyExlySignature(body, signature)) {
    return json(res, 401, { error: 'invalid signature' });
  }

  const phone = body.phone || body.customer_phone;
  const email = body.email || body.customer_email;
  const name = body.name || body.customer_name;
  const checkoutId = body.checkout_id || body.order_id;
  const paidAmount = body.amount || body.paid_amount || 0;

  if (!phone) return json(res, 400, { error: 'missing phone' });

  const db = getSupabase();

  const { data: lead } = await db
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .single();

  if (!lead) {
    return json(res, 404, { error: 'lead not found for this phone' });
  }

  const program = lead.program_interest || body.program || '6wk_gym';
  const durationDays = PROGRAM_DURATIONS[program] || 42;
  const now = new Date();
  const endsAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

  await db.from('leads')
    .update({ status: 'converted' })
    .eq('id', lead.id);

  const { data: client } = await db.from('clients').insert({
    lead_id: lead.id,
    phone,
    name: name || lead.name,
    email,
    program,
    program_started_at: now.toISOString(),
    program_ends_at: endsAt.toISOString(),
    paid_amount: paidAmount,
    checkout_id: checkoutId,
    folder_url: `/clients/${lead.id}/`,
    status: 'active',
  }).select().single();

  await db.storage.from('clients').upload(
    `${client.id}/.keep`,
    '',
    { contentType: 'text/plain', upsert: true }
  );

  const market = detectMarket(phone);
  const hinglish = isHinglish(market);

  const onboardMsg = hinglish
    ? [`Welcome to ${program} program! Tumhara journey shuru hota hai ab. Week 1 ka plan jaldi aayega. Questions ho toh yahan message karo.`]
    : [`Welcome to the ${program} program! Your journey starts now. Your Week 1 plan will arrive shortly. Message here with any questions.`];

  await sendTemplate(phone, `onboard_${program}`, onboardMsg);

  if (program === '12wk') {
    try {
      await fetch(`https://fitnessbymaddy.com/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`,
        },
        body: JSON.stringify({ client_id: client.id, week_no: 1 }),
      });
    } catch (_) {
      // program generation is async; failure here is non-critical
    }
  }

  return json(res, 200, { ok: true, client_id: client.id, program });
};
