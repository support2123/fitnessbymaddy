const { getSupabase } = require('./lib/supabase');
const { sendTemplate } = require('./lib/whatsapp');
const { detectMarket, isHinglishMarket, cors, parseBody, maskPhone } = require('./lib/helpers');
const crypto = require('crypto');

function verifySignature(body, signature) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true;
  const hmac = crypto.createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex');
  return hmac === signature;
}

function programDuration(program) {
  if (program === '12wk') return 12 * 7;
  if (program && program.startsWith('6wk')) return 6 * 7;
  if (program === 'pcos' || program === '40plus') return 8 * 7;
  return 30;
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const body = await parseBody(req);
  const signature = req.headers['x-exly-signature'] || '';

  if (!verifySignature(body, signature)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const phone = body.phone || body.customer_phone;
  const email = body.email || body.customer_email;
  const name = body.name || body.customer_name;
  const checkoutId = body.checkout_id || body.order_id;
  const amount = body.amount || body.paid_amount;
  const productName = (body.product_name || body.product || '').toLowerCase();

  if (!phone) return res.status(400).json({ error: 'No phone' });

  let program = null;
  if (/12.?week|custom|flagship/.test(productName)) program = '12wk';
  else if (/pcos|warrior/.test(productName)) program = 'pcos';
  else if (/40\+|strong|plus/.test(productName)) program = '40plus';
  else if (/home/.test(productName)) program = '6wk_home';
  else if (/6.?week|shred|burn/.test(productName)) program = '6wk_gym';
  else if (/trial|zoom/.test(productName)) program = 'zoom_trial';
  else program = '6wk_gym';

  const db = getSupabase();

  const { data: lead } = await db
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .single();

  const leadId = lead?.id || null;

  if (lead) {
    await db.from('leads')
      .update({ status: 'converted', program_interest: program })
      .eq('id', lead.id);
  }

  const now = new Date();
  const endsAt = new Date(now.getTime() + programDuration(program) * 86400000);

  const { data: client, error } = await db.from('clients').insert({
    lead_id: leadId,
    phone,
    name,
    email,
    program,
    program_started_at: now.toISOString(),
    program_ends_at: endsAt.toISOString(),
    paid_amount: amount ? parseInt(amount, 10) : null,
    checkout_id: checkoutId,
    folder_url: null,
    status: 'active'
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });

  const folderPath = `clients/${client.id}`;
  await db.storage.from('client-files').upload(`${folderPath}/.keep`, new Blob(['']));

  await db.from('clients')
    .update({ folder_url: folderPath })
    .eq('id', client.id);

  const market = detectMarket(phone);
  const templateName = isHinglishMarket(market)
    ? `onboard_${program}_hi`
    : `onboard_${program}_en`;

  await sendTemplate(phone, templateName, [name || 'there']);

  if (program === '12wk') {
    try {
      const origin = `https://${req.headers.host || 'fitnessbymaddy.com'}`;
      await fetch(`${origin}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: client.id, week_no: 1 })
      });
    } catch (err) {
      console.error(`Week-1 program gen failed: ${maskPhone(phone)}: ${err.message}`);
    }
  }

  console.log(`Conversion: ${maskPhone(phone)} → ${program}`);
  return res.json({ success: true, client_id: client.id, program });
};
