const crypto = require('crypto');
const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./send-whatsapp');
const { maskPhone, detectMarket, isHinglish, programLabel, jsonResponse, cors } = require('./lib/helpers');

function verifySignature(body, signature) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true;
  const expected = crypto.createHmac('sha256', secret)
    .update(JSON.stringify(body))
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature || ''),
    Buffer.from(expected)
  );
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') { cors(res); return res.status(200).end(); }
  if (req.method !== 'POST') return jsonResponse(res, 405, { error: 'Method not allowed' });

  const sig = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'];
  if (process.env.EXLY_WEBHOOK_SECRET && !verifySignature(req.body, sig)) {
    return jsonResponse(res, 401, { error: 'Invalid signature' });
  }

  const supabase = getSupabase();
  const data = req.body;

  const phone = data.phone || data.customer_phone || data.mobile;
  const name = data.name || data.customer_name || '';
  const email = data.email || data.customer_email || '';
  const amount = data.amount || data.paid_amount || 0;
  const checkoutId = data.checkout_id || data.order_id || data.transaction_id || '';
  const productName = (data.product || data.product_name || '').toLowerCase();

  if (!phone) return jsonResponse(res, 400, { error: 'No phone number' });

  const cleanPhone = phone.startsWith('+') ? phone : '+' + phone.replace(/\s/g, '');
  const market = detectMarket(cleanPhone);

  let program = '6wk_gym';
  if (/12.?week|custom|flagship/.test(productName)) program = '12wk';
  else if (/pcos|hormonal/.test(productName)) program = 'pcos';
  else if (/40\+|forty|menopause/.test(productName)) program = '40plus';
  else if (/zoom.*trial|trial.*zoom/.test(productName)) program = 'zoom_trial';
  else if (/zoom.*pack|pack.*zoom/.test(productName)) program = 'zoom_pack';
  else if (/home|bodyweight/.test(productName)) program = '6wk_home';

  const programWeeks = { '6wk_gym': 6, '6wk_home': 6, '12wk': 12, 'pcos': 6, '40plus': 8, 'zoom_trial': 1, 'zoom_pack': 4 };
  const weeks = programWeeks[program] || 6;
  const endsAt = new Date();
  endsAt.setDate(endsAt.getDate() + weeks * 7);

  const { data: lead } = await supabase
    .from('leads')
    .select('id')
    .eq('phone', cleanPhone)
    .single();

  if (lead) {
    await supabase.from('leads').update({ status: 'converted' }).eq('id', lead.id);
  } else {
    await supabase.from('leads').insert({
      phone: cleanPhone, name, source: 'exly',
      status: 'converted', market,
    });
  }

  const leadId = lead?.id || (await supabase.from('leads').select('id').eq('phone', cleanPhone).single()).data?.id;

  const folderPath = `clients/${Date.now()}`;

  const { data: client, error: insertErr } = await supabase.from('clients').insert({
    lead_id: leadId,
    phone: cleanPhone,
    name, email, program,
    program_started_at: new Date().toISOString(),
    program_ends_at: endsAt.toISOString(),
    paid_amount: parseInt(amount) || 0,
    checkout_id: checkoutId,
    folder_url: folderPath,
    status: 'active',
  }).select().single();

  if (insertErr) {
    console.error('Client insert error:', insertErr);
    return jsonResponse(res, 500, { error: 'Failed to create client' });
  }

  const hinglish = isHinglish(market);
  const templateName = hinglish ? `onboard_${program}_hi` : `onboard_${program}`;
  await sendWhatsApp({
    phone: cleanPhone,
    templateName,
    bodyValues: [name || 'there', programLabel(program)],
    isClient: true,
  });

  if (program === '12wk') {
    try {
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'https://fitnessbymaddy.com';
      await fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`,
        },
        body: JSON.stringify({ client_id: client.id, week_no: 1 }),
      });
    } catch (e) {
      console.error('Week 1 program gen trigger failed:', e.message);
    }
  }

  console.log(`Conversion: ${maskPhone(cleanPhone)} -> ${program} $${amount}`);
  return jsonResponse(res, 200, { success: true, clientId: client.id });
};
