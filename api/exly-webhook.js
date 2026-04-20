const crypto = require('crypto');
const { supabase } = require('./lib/supabase');
const { sendTemplate, detectMarket } = require('./lib/whatsapp');

const PROGRAM_DURATIONS = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 30,
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (process.env.EXLY_WEBHOOK_SECRET) {
    const sig = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'] || '';
    const expected = crypto
      .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
      .update(JSON.stringify(req.body))
      .digest('hex');
    if (sig && sig !== expected) {
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }

  const {
    phone, email, name, amount, checkout_id,
    product_name, product_id,
  } = req.body;

  if (!phone) return res.status(400).json({ error: 'phone required' });

  const normalizedPhone = phone.startsWith('+') ? phone : '+' + phone;

  const { data: lead } = await supabase
    .from('leads')
    .select('*')
    .eq('phone', normalizedPhone)
    .single();

  const program = lead?.program_interest || inferProgram(product_name || product_id || '');
  const durationDays = PROGRAM_DURATIONS[program] || 42;
  const endDate = new Date(Date.now() + durationDays * 86400000).toISOString();

  if (lead) {
    await supabase
      .from('leads')
      .update({ status: 'converted' })
      .eq('id', lead.id);
  }

  const { data: existingClient } = await supabase
    .from('clients')
    .select('*')
    .eq('phone', normalizedPhone)
    .single();

  let clientId;

  if (existingClient) {
    await supabase.from('clients').update({
      status: 'active',
      program,
      paid_amount: amount,
      checkout_id,
      program_started_at: new Date().toISOString(),
      program_ends_at: endDate,
      name: name || existingClient.name,
      email: email || existingClient.email,
    }).eq('id', existingClient.id);
    clientId = existingClient.id;
  } else {
    const { data: newClient } = await supabase.from('clients').insert({
      lead_id: lead?.id,
      phone: normalizedPhone,
      name,
      email,
      program,
      paid_amount: amount,
      checkout_id,
      program_started_at: new Date().toISOString(),
      program_ends_at: endDate,
      status: 'active',
    }).select().single();
    clientId = newClient?.id;
  }

  if (clientId) {
    await supabase.storage
      .from('clients')
      .upload(`${clientId}/.keep`, Buffer.from(''), { upsert: true });
  }

  const templateName = `onboard_${program}`;
  await sendTemplate(normalizedPhone, templateName, [name || 'there']);

  if (program === '12wk' && clientId) {
    await triggerProgramGeneration(clientId);
  }

  return res.status(200).json({ status: 'converted', client_id: clientId });
};

function inferProgram(productStr) {
  const lower = productStr.toLowerCase();
  if (lower.includes('12') || lower.includes('flagship')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40')) return '40plus';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('trial') || lower.includes('zoom')) return 'zoom_trial';
  return '6wk_gym';
}

async function triggerProgramGeneration(clientId) {
  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'https://fitnessbymaddy.com';

  try {
    await fetch(`${baseUrl}/api/generate-program`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-key': process.env.SUPABASE_SERVICE_KEY,
      },
      body: JSON.stringify({ client_id: clientId, week_no: 1 }),
    });
  } catch (err) {
    console.error('Program generation trigger failed:', err.message);
  }
}
