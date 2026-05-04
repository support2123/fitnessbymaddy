const crypto = require('crypto');
const { supabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');

const PROGRAM_DURATIONS = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 30
};

function verifySignature(payload, signature) {
  if (!process.env.EXLY_WEBHOOK_SECRET) return true;
  const expected = crypto
    .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
    .update(JSON.stringify(payload))
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature || ''),
    Buffer.from(expected)
  );
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const signature = req.headers['x-exly-signature'];
    if (process.env.EXLY_WEBHOOK_SECRET && !verifySignature(req.body, signature)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const {
      phone, name, email, program, amount, checkout_id
    } = req.body;

    if (!phone || !program) {
      return res.status(400).json({ error: 'Missing required fields: phone, program' });
    }

    // Find or create lead
    let leadId = null;
    const { data: lead } = await supabase
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1);

    if (lead && lead.length > 0) {
      leadId = lead[0].id;
      await supabase
        .from('leads')
        .update({ status: 'converted' })
        .eq('id', leadId);
    }

    // Calculate program end date
    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + durationDays * 24 * 60 * 60 * 1000);

    // Create client
    const folderPath = `clients/${Date.now()}_${phone.slice(-4)}`;
    const { data: client, error } = await supabase
      .from('clients')
      .insert({
        lead_id: leadId,
        phone,
        name: name || null,
        email: email || null,
        program,
        program_started_at: startDate.toISOString(),
        program_ends_at: endDate.toISOString(),
        paid_amount: amount ? parseInt(amount) : null,
        checkout_id: checkout_id || null,
        folder_url: folderPath,
        status: 'active'
      })
      .select('id')
      .single();

    if (error) throw error;

    // Create storage folder
    const emptyFile = new Uint8Array([]);
    await supabase.storage
      .from('clients')
      .upload(`${folderPath}/.keep`, emptyFile, { upsert: true });

    // Send onboarding WhatsApp template
    await sendTemplate(phone, `onboard_${program}`, [name || 'there']);

    // For 12-week program: trigger immediate Week 1 program generation
    if (program === '12wk') {
      const generateUrl = `${process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : 'https://fitnessbymaddy.com'}/api/generate-program`;
      fetch(generateUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`
        },
        body: JSON.stringify({ client_id: client.id, week_no: 1 })
      }).catch(err => console.error('Week 1 program generation failed:', err.message));
    }

    return res.status(200).json({ success: true, client_id: client.id });

  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Failed to process purchase' });
  }
};
