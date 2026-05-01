const crypto = require('crypto');
const { getSupabase } = require('../lib/supabase');
const { cors, maskPhone } = require('../lib/helpers');
const { sendTemplate, notifyMaddy } = require('../lib/whatsapp');

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

    if (sig !== expected) {
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }

  const {
    customer_phone, customer_name, customer_email,
    product_name, amount, checkout_id
  } = req.body;

  if (!customer_phone) return res.status(400).json({ error: 'Missing phone' });

  const db = getSupabase();
  const phone = customer_phone.startsWith('+') ? customer_phone : `+${customer_phone}`;

  const { data: lead } = await db
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .single();

  const program = mapProductToProgram(product_name);
  const weeks = program === '12wk' ? 12 : program === '40plus' ? 8 : 6;
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + weeks * 7);

  if (lead) {
    await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
  }

  const { data: client, error } = await db.from('clients').insert({
    lead_id: lead?.id || null,
    phone,
    name: customer_name || lead?.name || null,
    email: customer_email || null,
    program,
    program_started_at: new Date().toISOString(),
    program_ends_at: endDate.toISOString(),
    paid_amount: amount ? parseInt(amount) : null,
    checkout_id: checkout_id || null,
    folder_url: null,
    status: 'active'
  }).select().single();

  if (error) {
    console.error('Client creation failed:', error.message);
    return res.status(500).json({ error: 'Failed to create client' });
  }

  const folderPath = `clients/${client.id}`;
  await db.storage.from('programs').upload(`${folderPath}/.keep`, new Uint8Array(0), {
    contentType: 'text/plain', upsert: true
  });
  await db.from('clients').update({ folder_url: folderPath }).eq('id', client.id);

  const templateName = `onboard_${program}`;
  await sendTemplate(phone, templateName, [customer_name || 'there']);

  if (program === '12wk') {
    try {
      const origin = `https://${req.headers.host}`;
      await fetch(`${origin}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: client.id })
      });
    } catch (err) {
      console.error('Week-1 program generation failed:', err.message);
    }
  }

  return res.json({ ok: true, client_id: client.id });
};

function mapProductToProgram(productName) {
  if (!productName) return '6wk_gym';
  const lower = productName.toLowerCase();
  if (lower.includes('12') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('pcos') || lower.includes('warrior')) return 'pcos';
  if (lower.includes('40') || lower.includes('strong') || lower.includes('plus')) return '40plus';
  if (lower.includes('zoom') && lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('zoom') && lower.includes('pack')) return 'zoom_pack';
  if (lower.includes('home')) return '6wk_home';
  return '6wk_gym';
}
