const crypto = require('crypto');
const { supabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { escalate } = require('../lib/escalation');
const { isHinglish } = require('../lib/market');

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
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    if (process.env.EXLY_WEBHOOK_SECRET) {
      const signature = req.headers['x-exly-signature'];
      const expected = crypto
        .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (signature && signature !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const { phone, name, email, product, amount, checkout_id, status } = req.body;

    if (status === 'failed') {
      const { data: lead } = await supabase
        .from('leads').select('id').eq('phone', phone).single();
      await escalate(phone, 'Payment failure', `Payment of $${amount} failed for ${product}`, lead?.id);
      return res.json({ action: 'payment_failure_escalated' });
    }

    if (!phone || !product) {
      return res.status(400).json({ error: 'Missing phone or product' });
    }

    const program = normalizeProgram(product);
    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const programEnds = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000);

    const { data: lead } = await supabase
      .from('leads').select('*').eq('phone', phone).single();

    if (lead) {
      await supabase.from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const { data: client, error } = await supabase.from('clients').insert({
      lead_id: lead?.id || null,
      phone,
      name: name || lead?.name,
      email,
      program,
      program_started_at: new Date().toISOString(),
      program_ends_at: programEnds.toISOString(),
      paid_amount: parseFloat(amount) || 0,
      checkout_id,
      folder_url: null,
      status: 'active',
    }).select().single();

    if (error) throw error;

    const folderPath = `clients/${client.id}`;
    await supabase.storage.from('clients').upload(
      `${folderPath}/.keep`, new Uint8Array(0), { contentType: 'text/plain' }
    );

    await supabase.from('clients')
      .update({ folder_url: folderPath })
      .eq('id', client.id);

    const market = lead?.market || 'IN';
    const templateName = isHinglish(market)
      ? `onboard_${program}_hi`
      : `onboard_${program}_en`;

    await sendTemplate(phone, templateName, [
      name || lead?.name || 'there',
      program,
      durationDays.toString(),
    ]);

    if (program === '12wk') {
      await triggerProgramGeneration(client.id, 1);
    }

    return res.json({ action: 'converted', client_id: client.id, program });
  } catch (err) {
    console.error('exly-webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function normalizeProgram(product) {
  const lower = (product || '').toLowerCase();
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40') || lower.includes('forty')) return '40plus';
  if (lower.includes('12') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('zoom') && lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('zoom')) return 'zoom_pack';
  return '6wk_gym';
}

async function triggerProgramGeneration(clientId, weekNo) {
  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'https://www.fitnessbymaddy.com';

  await fetch(`${baseUrl}/api/generate-program`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`,
    },
    body: JSON.stringify({ client_id: clientId, week_no: weekNo }),
  }).catch(err => console.error('Program generation trigger failed:', err.message));
}
