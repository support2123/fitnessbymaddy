const crypto = require('crypto');
const { getSupabase } = require('./lib/supabase');
const { sendTemplate } = require('./lib/whatsapp');

const PROGRAM_DURATIONS = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 30
};

const PROGRAM_TEMPLATES = {
  '6wk_gym': 'onboard_6wk_gym',
  '6wk_home': 'onboard_6wk_home',
  '12wk': 'onboard_12wk',
  'pcos': 'onboard_pcos',
  '40plus': 'onboard_40plus',
  'zoom_trial': 'onboard_zoom_trial',
  'zoom_pack': 'onboard_zoom_pack'
};

function verifyExlySignature(payload, signature) {
  if (!process.env.EXLY_WEBHOOK_SECRET) return true; // skip if not set
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
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const signature = req.headers['x-exly-signature'];
    if (!verifyExlySignature(req.body, signature)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const { phone, name, email, program, amount, checkout_id } = req.body;
    if (!phone || !program) {
      return res.status(400).json({ error: 'Missing phone or program' });
    }

    const db = getSupabase();

    // Find or create lead
    let { data: lead } = await db
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .single();

    if (!lead) {
      const { data: newLead } = await db.from('leads').insert({
        phone,
        name,
        source: 'exly',
        status: 'converted'
      }).select('id').single();
      lead = newLead;
    } else {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    // Calculate program end date
    const days = PROGRAM_DURATIONS[program] || 42;
    const endsAt = new Date();
    endsAt.setDate(endsAt.getDate() + days);

    // Create client
    const { data: client } = await db.from('clients').insert({
      lead_id: lead.id,
      phone,
      name,
      email,
      program,
      program_ends_at: endsAt.toISOString(),
      paid_amount: amount || 0,
      checkout_id,
      folder_url: null,
      status: 'active'
    }).select('id').single();

    // Create storage folder path
    const folderUrl = `/clients/${client.id}/`;
    await db.from('clients').update({ folder_url: folderUrl }).eq('id', client.id);

    // Send welcome message
    const template = PROGRAM_TEMPLATES[program] || 'onboard_6wk_gym';
    await sendTemplate(phone, template, [name || 'there']);

    // For 12-week program, trigger first program generation
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
      } catch (genErr) {
        console.error('Program generation trigger failed:', genErr.message);
      }
    }

    return res.json({ ok: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
