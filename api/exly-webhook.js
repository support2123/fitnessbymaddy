const crypto = require('crypto');
const { getSupabase } = require('./lib/supabase');
const { sendTemplate, detectMarket, isHinglish } = require('./lib/whatsapp');
const { cors, parseBody, normalizePhone, programDurationWeeks } = require('./lib/helpers');

function verifySignature(body, signature) {
  if (!process.env.EXLY_WEBHOOK_SECRET) return true;
  const expected = crypto
    .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
    .update(JSON.stringify(body))
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature || ''), Buffer.from(expected));
}

const PROGRAM_MAP = {
  '6_week_shred': '6wk_gym',
  '6_week_home': '6wk_home',
  '12_week_custom': '12wk',
  'pcos_warrior': 'pcos',
  '40_plus': '40plus',
  'zoom_trial': 'zoom_trial',
  'zoom_pack': 'zoom_pack'
};

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const body = await parseBody(req);
  const sig = req.headers['x-exly-signature'] || '';

  if (process.env.EXLY_WEBHOOK_SECRET && !verifySignature(body, sig)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const db = getSupabase();

  const phone = normalizePhone(body.phone || body.customer_phone || '');
  const name = body.name || body.customer_name || '';
  const email = body.email || body.customer_email || '';
  const amount = body.amount || body.paid_amount || 0;
  const checkoutId = body.checkout_id || body.order_id || '';
  const productKey = (body.product || body.program || '').toLowerCase().replace(/\s+/g, '_');
  const program = PROGRAM_MAP[productKey] || body.program || '12wk';

  if (!phone) return res.status(400).json({ error: 'Missing phone' });

  const { data: lead } = await db
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  const leadId = lead?.id || null;

  if (leadId) {
    await db.from('leads').update({ status: 'converted' }).eq('id', leadId);
  }

  const durationWeeks = programDurationWeeks(program);
  const endsAt = new Date();
  endsAt.setDate(endsAt.getDate() + durationWeeks * 7);

  const { data: client } = await db.from('clients').insert({
    lead_id: leadId,
    phone,
    name,
    email,
    program,
    program_started_at: new Date().toISOString(),
    program_ends_at: endsAt.toISOString(),
    paid_amount: amount,
    checkout_id: checkoutId,
    folder_url: null,
    status: 'active'
  }).select().single();

  const folderPath = `clients/${client.id}`;
  await db.storage.from('client-files').upload(`${folderPath}/.keep`, new Blob(['']));
  await db.from('clients').update({ folder_url: folderPath }).eq('id', client.id);

  const market = detectMarket(phone);
  const templateName = `onboard_${program}`;

  await sendTemplate(phone, templateName, {
    name: name || 'there',
    templateParams: [name || 'there', `${durationWeeks} weeks`]
  });

  if (program === '12wk') {
    const generateUrl = `${process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : 'https://fitnessbymaddy.com'}/api/generate-program`;
    await fetch(generateUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`
      },
      body: JSON.stringify({ client_id: client.id, week_no: 1 })
    }).catch(() => {});
  }

  return res.status(200).json({ success: true, client_id: client.id });
};
