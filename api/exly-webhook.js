const crypto = require('crypto');
const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');

const PROGRAM_MAP = {
  '6wk-shred': '6wk_gym',
  '6wk-home': '6wk_home',
  'pcos-warrior': 'pcos',
  '40plus-strong': '40plus',
  '12wk-custom': '12wk',
  'zoom-trial': 'zoom_trial',
  'zoom-pack': 'zoom_pack'
};

function verifyWebhook(body, signature) {
  if (!process.env.EXLY_WEBHOOK_SECRET) return true;
  const expected = crypto
    .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
    .update(JSON.stringify(body))
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature || ''), Buffer.from(expected));
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const signature = req.headers['x-exly-signature'] || '';
  if (!verifyWebhook(req.body, signature)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const supabase = getSupabase();
  const { event, data } = req.body;

  if (event !== 'payment.success' && event !== 'order.completed') {
    return res.status(200).json({ action: 'ignored', event });
  }

  const phone = data.phone || data.customer_phone;
  const email = data.email || data.customer_email;
  const name = data.name || data.customer_name;
  const productSlug = data.product_slug || data.item_slug || '';
  const amount = data.amount || data.total_amount;
  const checkoutId = data.checkout_id || data.order_id;

  const program = PROGRAM_MAP[productSlug] || '6wk_gym';

  // Find lead
  const { data: lead } = await supabase
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .single();

  const leadId = lead ? lead.id : null;

  if (lead) {
    await supabase.from('leads').update({ status: 'converted' }).eq('id', lead.id);
  }

  // Calculate program end date
  const startDate = new Date();
  const weeks = program === '12wk' ? 12 : program.startsWith('zoom') ? 4 : 6;
  const endDate = new Date(startDate.getTime() + weeks * 7 * 24 * 60 * 60 * 1000);

  // Create client
  const { data: client, error } = await supabase.from('clients').insert({
    lead_id: leadId,
    phone,
    name,
    email,
    program,
    program_started_at: startDate.toISOString(),
    program_ends_at: endDate.toISOString(),
    paid_amount: amount,
    checkout_id: checkoutId,
    status: 'active'
  }).select().single();

  if (error) return res.status(500).json({ error: 'Failed to create client' });

  // Create storage folder
  await supabase.storage
    .from('clients')
    .upload(`${client.id}/.keep`, new Blob(['']))
    .catch(() => {});

  // Send onboarding WhatsApp
  const template = `onboard_${program}`;
  await sendWhatsApp(phone, template, {
    name,
    templateParams: [name, String(weeks)]
  }).catch(() => {});

  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body: `Onboarding sent for ${program}`,
    template_name: template,
    sent_at: new Date().toISOString(),
    status: 'sent'
  });

  // For 12-week: trigger immediate Week 1 program generation
  if (program === '12wk') {
    const generateUrl = `${process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : 'https://www.fitnessbymaddy.com'}/api/generate-program`;
    fetch(generateUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: client.id, week_no: 1 })
    }).catch(() => {});
  }

  return res.status(200).json({ success: true, client_id: client.id, program });
};
