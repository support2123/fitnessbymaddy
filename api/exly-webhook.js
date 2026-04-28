const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secret = req.headers['x-webhook-secret'] || req.query.secret;
  if (secret !== process.env.EXLY_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Invalid webhook secret' });
  }

  const db = getSupabase();
  const {
    customer_phone, customer_name, customer_email,
    product_name, amount, checkout_id
  } = req.body;

  if (!customer_phone) {
    return res.status(400).json({ error: 'customer_phone required' });
  }

  const phone = customer_phone.startsWith('+') ? customer_phone : `+${customer_phone}`;

  const { data: lead } = await db
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .single();

  const program = detectProgram(product_name, lead?.program_interest);

  const programEndWeeks = {
    '6wk_gym': 6, '6wk_home': 6, '12wk': 12,
    'pcos': 6, '40plus': 6, 'zoom_trial': 1, 'zoom_pack': 4
  };
  const weeks = programEndWeeks[program] || 6;
  const startDate = new Date();
  const endDate = new Date(startDate.getTime() + weeks * 7 * 24 * 60 * 60 * 1000);

  const { data: client, error } = await db.from('clients').insert({
    lead_id: lead?.id || null,
    phone,
    name: customer_name || lead?.name || '',
    email: customer_email || '',
    program,
    program_started_at: startDate.toISOString(),
    program_ends_at: endDate.toISOString(),
    paid_amount: amount || 0,
    checkout_id: checkout_id || null,
    folder_url: null,
    status: 'active'
  }).select().single();

  if (error) {
    return res.status(500).json({ error: 'Failed to create client record' });
  }

  if (lead) {
    await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
  }

  const folderPath = `clients/${client.id}`;
  await db.storage.from('client-files').upload(`${folderPath}/.keep`, new Blob(['']));

  await db.from('clients').update({
    folder_url: folderPath
  }).eq('id', client.id);

  await sendWhatsApp(phone, `onboard_${program}`, [
    customer_name || 'there',
    `${weeks} weeks`
  ]);

  if (program === '12wk') {
    try {
      await fetch(`${process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : ''}/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.INTERNAL_API_KEY
        },
        body: JSON.stringify({ client_id: client.id, week_no: 1 })
      });
    } catch (e) {
      // Async generation; failures logged separately
    }
  }

  return res.status(200).json({ success: true, client_id: client.id, program });
};

function detectProgram(productName, leadInterest) {
  if (leadInterest) return leadInterest;
  if (!productName) return '6wk_gym';
  const lower = productName.toLowerCase();
  if (lower.includes('12') || lower.includes('flagship') || lower.includes('custom')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40')) return '40plus';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('trial') || lower.includes('zoom')) return 'zoom_trial';
  return '6wk_gym';
}
