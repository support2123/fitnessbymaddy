const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');
const crypto = require('crypto');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const signature = req.headers['x-exly-signature'];
  if (process.env.EXLY_WEBHOOK_SECRET && signature) {
    const expected = crypto
      .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
      .update(JSON.stringify(req.body))
      .digest('hex');
    if (signature !== expected) {
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }

  const db = getSupabase();
  const { phone, email, name, amount, checkout_id, product_name } = req.body;

  const normalizedPhone = (phone || '').replace(/[\s\-\+\(\)]/g, '');
  if (!normalizedPhone) return res.status(400).json({ error: 'No phone' });

  const program = mapProductToProgram(product_name);
  const programDuration = getProgramDuration(program);

  const { data: lead } = await db
    .from('leads')
    .select('*')
    .eq('phone', normalizedPhone)
    .limit(1)
    .single();

  const leadId = lead ? lead.id : null;

  if (lead) {
    await db.from('leads')
      .update({ status: 'converted' })
      .eq('id', lead.id);
  }

  const now = new Date();
  const endsAt = new Date(now);
  endsAt.setDate(endsAt.getDate() + programDuration);

  const { data: client, error } = await db.from('clients').insert({
    lead_id: leadId,
    phone: normalizedPhone,
    name: name || (lead && lead.name) || '',
    email: email || '',
    program,
    program_started_at: now.toISOString(),
    program_ends_at: endsAt.toISOString(),
    paid_amount: amount || 0,
    checkout_id: checkout_id || '',
    status: 'active'
  }).select().single();

  if (error) {
    return res.status(500).json({ error: 'Failed to create client' });
  }

  const folderPath = `clients/${client.id}`;
  await db.storage.from('programs').upload(
    `${folderPath}/.keep`,
    new Blob([''], { type: 'text/plain' })
  );

  await db.from('clients')
    .update({ folder_url: folderPath })
    .eq('id', client.id);

  const templateName = `onboard_${program}`;
  await sendWhatsApp(normalizedPhone, templateName, {
    name: client.name || 'there',
    templateParams: [client.name || 'there', program]
  });

  if (program === '12wk') {
    const generateUrl = `${process.env.VERCEL_URL || 'https://fitnessbymaddy.com'}/api/generate-program`;
    await fetch(generateUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`
      },
      body: JSON.stringify({ client_id: client.id, week_no: 1 })
    });
  }

  return res.status(200).json({ success: true, client_id: client.id });
};

function mapProductToProgram(productName) {
  const name = (productName || '').toLowerCase();
  if (name.includes('6') && name.includes('home')) return '6wk_home';
  if (name.includes('6') || name.includes('shred') || name.includes('burn')) return '6wk_gym';
  if (name.includes('12') || name.includes('custom') || name.includes('flagship')) return '12wk';
  if (name.includes('pcos') || name.includes('pcod')) return 'pcos';
  if (name.includes('40') || name.includes('strong')) return '40plus';
  if (name.includes('zoom') && name.includes('pack')) return 'zoom_pack';
  if (name.includes('trial') || name.includes('zoom')) return 'zoom_trial';
  return '6wk_gym';
}

function getProgramDuration(program) {
  const durations = {
    '6wk_gym': 42,
    '6wk_home': 42,
    '12wk': 84,
    'pcos': 42,
    '40plus': 42,
    'zoom_trial': 7,
    'zoom_pack': 28
  };
  return durations[program] || 42;
}
