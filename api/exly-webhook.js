const crypto = require('crypto');
const { supabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');

const PROGRAM_DURATIONS = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 30,
};

function verifyWebhookSignature(body, signature) {
  if (!process.env.EXLY_WEBHOOK_SECRET) return true;
  const expected = crypto
    .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
    .update(JSON.stringify(body))
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature || ''), Buffer.from(expected));
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const signature = req.headers['x-exly-signature'];
    if (process.env.EXLY_WEBHOOK_SECRET && !verifyWebhookSignature(req.body, signature)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const { phone, name, email, program, amount, checkout_id } = req.body;

    if (!phone || !program) {
      return res.status(400).json({ error: 'Missing phone or program' });
    }

    // Find or create lead
    let { data: lead } = await supabase
      .from('leads').select('*').eq('phone', phone).single();

    if (!lead) {
      const { data: newLead } = await supabase.from('leads').insert({
        phone,
        name,
        source: 'exly',
        status: 'converted',
        program_interest: program,
      }).select().single();
      lead = newLead;
    } else {
      await supabase.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    // Calculate program end date
    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const endsAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString();

    // Create client
    const { data: client, error } = await supabase.from('clients').insert({
      lead_id: lead.id,
      phone,
      name: name || lead.name,
      email,
      program,
      program_ends_at: endsAt,
      paid_amount: parseInt(amount) || 0,
      checkout_id,
      folder_url: `/clients/${lead.id}/`,
      status: 'active',
    }).select().single();

    if (error) throw error;

    // Create storage folder
    const emptyFile = new Uint8Array(0);
    await supabase.storage
      .from('client-files')
      .upload(`clients/${client.id}/.keep`, emptyFile, { upsert: true });

    // Send onboarding WhatsApp
    await sendWhatsApp({
      phone,
      templateName: `onboard_${program}`,
      bodyValues: [name || 'there'],
    });

    // For 12-week, trigger immediate Week-1 program generation
    if (program === '12wk') {
      const baseUrl = `https://${req.headers.host}`;
      fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: client.id, week_no: 1 }),
      }).catch(() => {});
    }

    return res.status(200).json({ ok: true, clientId: client.id });

  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
