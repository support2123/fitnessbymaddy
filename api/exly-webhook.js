const { getSupabase } = require('./_lib/supabase');
const { sendTemplate } = require('./_lib/whatsapp');
const { isHinglish } = require('./_lib/market');
const crypto = require('crypto');

const PROGRAM_DURATION_WEEKS = {
  '6wk_gym': 6,
  '6wk_home': 6,
  '12wk': 12,
  'pcos': 8,
  '40plus': 8,
  'zoom_trial': 1,
  'zoom_pack': 4
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (secret) {
    const sig = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'] || '';
    const body = JSON.stringify(req.body);
    const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
    if (sig && sig !== expected) {
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }

  const supabase = getSupabase();
  const {
    phone, email, name, amount, checkout_id,
    product_name, status: paymentStatus
  } = req.body;

  if (!phone || paymentStatus !== 'completed') {
    return res.status(200).json({ action: 'ignored' });
  }

  const { data: lead } = await supabase
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .single();

  const program = lead?.program_interest || inferProgram(product_name);
  const durationWeeks = PROGRAM_DURATION_WEEKS[program] || 6;
  const endsAt = new Date();
  endsAt.setDate(endsAt.getDate() + durationWeeks * 7);

  if (lead) {
    await supabase
      .from('leads')
      .update({ status: 'converted' })
      .eq('id', lead.id);
  }

  const { data: client, error: clientErr } = await supabase
    .from('clients')
    .insert({
      lead_id: lead?.id || null,
      phone,
      name: name || lead?.name,
      email,
      program,
      program_started_at: new Date().toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: Math.round((amount || 0) * 100),
      checkout_id,
      status: 'active'
    })
    .select()
    .single();

  if (clientErr) {
    console.error('Client creation failed:', clientErr.message);
    return res.status(500).json({ error: 'Failed to create client' });
  }

  const folderPath = `clients/${client.id}`;
  await supabase.storage
    .from('clients')
    .upload(`${folderPath}/.keep`, new Blob(['']));

  await supabase
    .from('clients')
    .update({ folder_url: folderPath })
    .eq('id', client.id);

  const market = lead?.market || 'GLOBAL';
  const templateName = `onboard_${program}`;
  const params = isHinglish(market)
    ? [name || 'there', `Week 1 shuru! Intake form fill karo: https://fitnessbymaddy.com/intake.html?lead=${lead?.id || client.id}`]
    : [name || 'there', `Week 1 begins! Fill your intake form: https://fitnessbymaddy.com/intake.html?lead=${lead?.id || client.id}`];

  await sendTemplate(phone, templateName, params, true);

  if (program === '12wk') {
    try {
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'https://fitnessbymaddy.com';

      await fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`
        },
        body: JSON.stringify({ client_id: client.id, week_no: 1 })
      });
    } catch (err) {
      console.error('Week-1 program generation trigger failed:', err.message);
    }
  }

  return res.status(200).json({ action: 'converted', client_id: client.id });
};

function inferProgram(productName) {
  if (!productName) return '6wk_gym';
  const lower = productName.toLowerCase();
  if (lower.includes('12') || lower.includes('custom')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40')) return '40plus';
  if (lower.includes('trial') || lower.includes('zoom')) return 'zoom_trial';
  if (lower.includes('home')) return '6wk_home';
  return '6wk_gym';
}
