const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');
const { cors, parseBody } = require('./lib/helpers');
const crypto = require('crypto');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = await parseBody(req);

  if (process.env.EXLY_WEBHOOK_SECRET) {
    const signature = req.headers['x-exly-signature'];
    const expected = crypto
      .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
      .update(JSON.stringify(body))
      .digest('hex');
    if (signature && signature !== expected) {
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }

  const { phone, name, email, amount, checkout_id, product_name } = body;

  if (!phone) return res.status(400).json({ error: 'Missing phone' });

  const db = getSupabase();

  const { data: lead } = await db
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .limit(1)
    .single();

  const programMap = {
    '6 week': '6wk_gym',
    'burn': '6wk_gym',
    'home': '6wk_home',
    'pcos': 'pcos',
    '40+': '40plus',
    '40 plus': '40plus',
    '12 week': '12wk',
    'flagship': '12wk',
    'trial': 'zoom_trial',
    'zoom': 'zoom_trial',
    'pack': 'zoom_pack',
  };

  let program = '6wk_gym';
  if (product_name) {
    const lower = product_name.toLowerCase();
    for (const [key, val] of Object.entries(programMap)) {
      if (lower.includes(key)) { program = val; break; }
    }
  }
  if (lead?.program_interest) program = lead.program_interest;

  const programDuration = {
    '6wk_gym': 42, '6wk_home': 42, '12wk': 84,
    'pcos': 42, '40plus': 42, 'zoom_trial': 7, 'zoom_pack': 28,
  };
  const daysToAdd = programDuration[program] || 42;
  const endsAt = new Date(Date.now() + daysToAdd * 24 * 60 * 60 * 1000).toISOString();

  const clientData = {
    lead_id: lead?.id || null,
    phone,
    name: name || lead?.name || null,
    email: email || null,
    program,
    program_started_at: new Date().toISOString(),
    program_ends_at: endsAt,
    paid_amount: amount ? parseInt(amount) : 0,
    checkout_id: checkout_id || null,
    folder_url: null,
    status: 'active',
  };

  const { data: client, error } = await db
    .from('clients')
    .insert(clientData)
    .select()
    .single();

  if (error) {
    console.error('[EXLY] Client insert error:', error.message);
    return res.status(500).json({ error: 'Failed to create client' });
  }

  if (lead) {
    await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
  }

  const folderPath = `clients/${client.id}`;
  await db.storage.from('clients').upload(
    `${folderPath}/.keep`,
    'initialized',
    { contentType: 'text/plain', upsert: true }
  );

  await db.from('clients').update({ folder_url: folderPath }).eq('id', client.id);

  await sendWhatsApp({
    phone,
    templateName: `onboard_${program}`,
    params: [name || 'there', program],
  });

  if (program === '12wk') {
    try {
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'https://fitnessbymaddy.com';
      await fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: client.id, week_no: 1 }),
      });
    } catch (e) {
      console.error('[EXLY] Week-1 program generation failed:', e.message);
    }
  }

  return res.status(200).json({ success: true, client_id: client.id });
};
