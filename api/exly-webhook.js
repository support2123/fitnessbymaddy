const { supabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { programWeeks, cors } = require('../lib/helpers');
const crypto = require('crypto');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  if (process.env.EXLY_WEBHOOK_SECRET) {
    const sig = req.headers['x-exly-signature'] || '';
    const expected = crypto
      .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
      .update(JSON.stringify(req.body))
      .digest('hex');
    if (sig !== expected) return res.status(401).json({ error: 'Invalid signature' });
  }

  const { phone, email, name, amount, checkout_id, product_name } = req.body;
  if (!phone) return res.status(400).json({ error: 'Missing phone' });

  const lead = await supabase.from('leads').select('*').eq('phone', phone).single();
  const program = mapProduct(product_name, lead.data?.program_interest);

  if (lead.data) {
    await supabase.from('leads').update({ status: 'converted' }).eq('id', lead.data.id);
  }

  const weeks = programWeeks(program);
  const startDate = new Date();
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + weeks * 7);

  const { data: client, error } = await supabase.from('clients').insert({
    lead_id: lead.data?.id || null,
    phone,
    name: name || lead.data?.name,
    email,
    program,
    program_started_at: startDate.toISOString(),
    program_ends_at: endDate.toISOString(),
    paid_amount: amount ? parseInt(amount) : 0,
    checkout_id: checkout_id || null,
    folder_url: null,
    status: 'active',
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });

  const folderPath = `clients/${client.id}`;
  await supabase.storage.from('clients').upload(`${folderPath}/.init`, new Blob(['']));
  await supabase.from('clients').update({ folder_url: folderPath }).eq('id', client.id);

  await sendWhatsApp(phone, null, `onboard_${program}`);

  if (program === '12wk') {
    try {
      const origin = `https://${req.headers.host}`;
      await fetch(`${origin}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: client.id, week_no: 1 }),
      });
    } catch (_) {}
  }

  return res.json({ success: true, client_id: client.id });
};

function mapProduct(productName, fallbackProgram) {
  const lower = (productName || '').toLowerCase();
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40+') || lower.includes('40 plus')) return '40plus';
  if (lower.includes('12') || lower.includes('flagship') || lower.includes('custom')) return '12wk';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('6') || lower.includes('shred') || lower.includes('burn')) return '6wk_gym';
  if (lower.includes('trial') || lower.includes('zoom')) return 'zoom_trial';
  return fallbackProgram || '6wk_gym';
}
