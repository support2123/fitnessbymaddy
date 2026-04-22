const { supabase } = require('./_lib/supabase');
const { sendWhatsApp, normalizePhone, notifyMaddy, maskPhone } = require('./_lib/whatsapp');
const { parseBody, cors, json, programDuration, programLabel } = require('./_lib/helpers');
const crypto = require('crypto');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
  if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });

  const body = await parseBody(req);

  if (process.env.EXLY_WEBHOOK_SECRET) {
    const signature = req.headers['x-exly-signature'] || '';
    const expected = crypto
      .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
      .update(JSON.stringify(body))
      .digest('hex');
    if (signature !== expected) {
      return json(res, 401, { error: 'Invalid signature' });
    }
  }

  const phone = normalizePhone(body.phone || body.customer_phone || '');
  const email = body.email || body.customer_email || null;
  const name = body.name || body.customer_name || null;
  const checkoutId = body.checkout_id || body.order_id || null;
  const amount = body.amount || body.paid_amount || 0;
  const programRaw = (body.product_name || body.program || '').toLowerCase();

  if (!phone) return json(res, 400, { error: 'phone required' });

  let programKey = '6wk_gym';
  if (/12\s*week|custom|flagship/.test(programRaw)) programKey = '12wk';
  else if (/pcos|hormonal/.test(programRaw)) programKey = 'pcos';
  else if (/40\+|40plus|senior/.test(programRaw)) programKey = '40plus';
  else if (/zoom.*trial|trial/.test(programRaw)) programKey = 'zoom_trial';
  else if (/zoom.*pack/.test(programRaw)) programKey = 'zoom_pack';
  else if (/home/.test(programRaw)) programKey = '6wk_home';

  let { data: lead } = await supabase
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .limit(1)
    .single();

  if (!lead) {
    const { data: newLead } = await supabase
      .from('leads')
      .insert({ phone, name, source: 'exly', status: 'new', program_interest: programKey })
      .select()
      .single();
    lead = newLead;
  }

  await supabase
    .from('leads')
    .update({ status: 'converted', program_interest: programKey })
    .eq('id', lead.id);

  const now = new Date();
  const endDate = new Date(now.getTime() + programDuration(programKey) * 24 * 60 * 60 * 1000);

  const { data: existingClient } = await supabase
    .from('clients')
    .select('id')
    .eq('lead_id', lead.id)
    .limit(1)
    .single();

  let clientId;
  if (existingClient) {
    await supabase.from('clients').update({
      program: programKey,
      status: 'active',
      paid_amount: amount,
      checkout_id: checkoutId,
      program_started_at: now.toISOString(),
      program_ends_at: endDate.toISOString(),
    }).eq('id', existingClient.id);
    clientId = existingClient.id;
  } else {
    const { data: client } = await supabase.from('clients').insert({
      lead_id: lead.id,
      phone,
      name: name || lead.name,
      email,
      program: programKey,
      status: 'active',
      paid_amount: amount,
      checkout_id: checkoutId,
      program_started_at: now.toISOString(),
      program_ends_at: endDate.toISOString(),
    }).select().single();
    clientId = client.id;
  }

  const folderPath = `clients/${clientId}`;
  await supabase.from('clients').update({ folder_url: folderPath }).eq('id', clientId);

  const label = programLabel(programKey);
  const market = lead.market || 'IN';
  const isHinglish = market === 'IN';

  const onboardMsg = isHinglish
    ? `🎉 Welcome to the team!\n\n` +
      `${label} mein tera enrollment confirm ho gaya hai.\n\n` +
      `Next steps:\n` +
      `1️⃣ Intake form fill karo (agar nahi kiya): https://fitnessbymaddy.com/intake?lead=${lead.id}\n` +
      `2️⃣ Week 1 ka program 24 hours mein aa jayega\n` +
      `3️⃣ Weekly check-in har Sunday aayega\n\n` +
      `Let's crush this! 💪`
    : `🎉 Welcome to the team!\n\n` +
      `You're now enrolled in ${label}.\n\n` +
      `Next steps:\n` +
      `1️⃣ Fill the intake form (if not done): https://fitnessbymaddy.com/intake?lead=${lead.id}\n` +
      `2️⃣ Your Week 1 program will arrive within 24 hours\n` +
      `3️⃣ Weekly check-ins will be sent every Sunday\n\n` +
      `Let's crush this! 💪`;

  await sendWhatsApp({ phone, body: onboardMsg, templateName: `onboard_${programKey}` });

  if (programKey === '12wk') {
    try {
      const baseUrl = `https://${req.headers.host}`;
      await fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`,
        },
        body: JSON.stringify({ client_id: clientId, week_no: 1 }),
      });
    } catch (err) {
      console.error('Week 1 program generation failed:', err.message);
    }
  }

  return json(res, 200, { success: true, client_id: clientId, program: programKey });
};
