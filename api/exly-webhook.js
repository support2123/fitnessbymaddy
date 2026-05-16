const crypto = require('crypto');
const { getSupabase } = require('./lib/supabase');
const { sendTemplate } = require('./lib/whatsapp');
const { logMessage } = require('./lib/rate-limit');

function verifySignature(body, signature) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true;
  const expected = crypto.createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature || ''), Buffer.from(expected));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const signature = req.headers['x-exly-signature'];
  if (process.env.EXLY_WEBHOOK_SECRET && !verifySignature(req.body, signature)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const { email, phone, name, product, amount, checkout_id } = req.body;
  if (!phone || !product) {
    return res.status(400).json({ error: 'phone and product required' });
  }

  const db = getSupabase();

  const programMap = {
    '6_week_shred': '6wk_gym',
    '6_week_home': '6wk_home',
    '12_week_custom': '12wk',
    'pcos_warrior': 'pcos',
    '40_plus_strong': '40plus',
    'zoom_trial': 'zoom_trial',
    'zoom_pack': 'zoom_pack'
  };

  const program = programMap[product] || product;

  const programDurations = {
    '6wk_gym': 42,
    '6wk_home': 42,
    '12wk': 84,
    'pcos': 42,
    '40plus': 42,
    'zoom_trial': 7,
    'zoom_pack': 28
  };

  const durationDays = programDurations[program] || 42;
  const startDate = new Date();
  const endDate = new Date(startDate.getTime() + durationDays * 24 * 60 * 60 * 1000);

  const { data: lead } = await db
    .from('leads')
    .select('id')
    .eq('phone', phone)
    .single();

  if (lead) {
    await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
  }

  const { data: client, error } = await db.from('clients').insert({
    lead_id: lead ? lead.id : null,
    phone,
    name: name || '',
    email: email || '',
    program,
    program_started_at: startDate.toISOString(),
    program_ends_at: endDate.toISOString(),
    paid_amount: amount || 0,
    checkout_id: checkout_id || '',
    status: 'active'
  }).select().single();

  if (error) {
    return res.status(500).json({ error: 'Failed to create client', detail: error.message });
  }

  const folderPath = `clients/${client.id}`;
  await db.storage.from('programs').upload(`${folderPath}/.keep`, new Uint8Array(0), {
    contentType: 'application/octet-stream',
    upsert: true
  });

  const templateName = `onboard_${program}`;
  await sendTemplate(phone, templateName, [name || 'there']);
  await logMessage(phone, 'out', `[Onboarding: ${templateName}]`, templateName);

  return res.status(200).json({ success: true, client_id: client.id, program });
};
