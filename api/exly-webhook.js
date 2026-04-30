const crypto = require('crypto');
const { getSupabase } = require('./_lib/supabase');
const { sendTemplate } = require('./_lib/whatsapp');

const PROGRAM_DURATIONS = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  pcos: 42,
  '40plus': 42,
  zoom_trial: 7,
  zoom_pack: 28,
};

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
  const {
    phone,
    email,
    name,
    checkout_id,
    amount,
    product_name,
  } = req.body;

  if (!phone) return res.status(400).json({ error: 'Phone required' });

  const { data: lead } = await db
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .maybeSingle();

  if (lead) {
    await db
      .from('leads')
      .update({ status: 'converted' })
      .eq('id', lead.id);
  }

  const program = lead?.program_interest || inferProgram(product_name, amount);
  const durationDays = PROGRAM_DURATIONS[program] || 42;
  const endsAt = new Date();
  endsAt.setDate(endsAt.getDate() + durationDays);

  const { data: existingClient } = await db
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .maybeSingle();

  let clientId;

  if (existingClient) {
    await db
      .from('clients')
      .update({
        status: 'active',
        program,
        paid_amount: amount,
        checkout_id,
        program_started_at: new Date().toISOString(),
        program_ends_at: endsAt.toISOString(),
        email: email || undefined,
        name: name || undefined,
      })
      .eq('id', existingClient.id);
    clientId = existingClient.id;
  } else {
    const { data: newClient } = await db
      .from('clients')
      .insert({
        lead_id: lead?.id,
        phone,
        name: name || lead?.name,
        email,
        program,
        paid_amount: amount,
        checkout_id,
        status: 'active',
        program_started_at: new Date().toISOString(),
        program_ends_at: endsAt.toISOString(),
      })
      .select()
      .single();
    clientId = newClient.id;
  }

  const folderPath = `clients/${clientId}`;
  await db.storage.from('clients').upload(`${clientId}/.keep`, new Blob(['']));

  await db
    .from('clients')
    .update({ folder_url: folderPath })
    .eq('id', clientId);

  const templateName = `onboard_${program}`;
  await sendTemplate(phone, templateName, [name || 'there']);

  if (program === '12wk') {
    try {
      const baseUrl = `https://${req.headers.host}`;
      await fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-key': process.env.INTERNAL_API_KEY,
        },
        body: JSON.stringify({ client_id: clientId, week_no: 1 }),
      });
    } catch (err) {
      console.error('Failed to trigger program generation:', err.message);
    }
  }

  return res.status(200).json({ ok: true, client_id: clientId, program });
};

function inferProgram(productName, amount) {
  if (!productName) return '6wk_gym';
  const lower = (productName || '').toLowerCase();
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40+') || lower.includes('40 plus')) return '40plus';
  if (lower.includes('12') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('trial') || lower.includes('zoom')) return 'zoom_trial';
  if (lower.includes('home')) return '6wk_home';
  if (amount && amount <= 2500) return 'zoom_trial';
  return '6wk_gym';
}
