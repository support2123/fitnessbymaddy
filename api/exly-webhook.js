const { supabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { maskPhone } = require('./_lib/mask');
const crypto = require('crypto');

const PROGRAM_DURATION = {
  '6wk_gym': 42, '6wk_home': 42, '12wk': 84,
  'pcos': 42, '40plus': 42, 'zoom_trial': 7, 'zoom_pack': 30
};

function verifyExlySignature(body, signature) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true;
  const expected = crypto.createHmac('sha256', secret)
    .update(JSON.stringify(body)).digest('hex');
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
    if (process.env.EXLY_WEBHOOK_SECRET && !verifyExlySignature(req.body, signature)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const {
      phone, name, email, checkout_id,
      amount, program
    } = req.body || {};

    if (!phone || !program) {
      return res.status(400).json({ error: 'phone and program required' });
    }

    const cleanPhone = phone.replace(/\D/g, '');

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', cleanPhone)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (lead) {
      await supabase
        .from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const durationDays = PROGRAM_DURATION[program] || 42;
    const endsAt = new Date();
    endsAt.setDate(endsAt.getDate() + durationDays);

    const folderPath = `clients/${crypto.randomUUID()}`;

    const { data: client, error } = await supabase.from('clients').insert({
      lead_id: lead?.id || null,
      phone: cleanPhone,
      name: name || lead?.name || null,
      email: email || null,
      program,
      program_ends_at: endsAt.toISOString(),
      paid_amount: amount ? parseInt(amount) : null,
      checkout_id: checkout_id || null,
      folder_url: folderPath,
      status: 'active'
    }).select().single();

    if (error) throw error;

    await sendWhatsApp(cleanPhone, `onboard_${program}`, {
      name: client.name || 'there',
      templateParams: [client.name || 'there'],
      isClient: true,
      skipRateLimit: true
    });

    if (program === '12wk') {
      const origin = `https://${req.headers.host || 'www.fitnessbymaddy.com'}`;
      fetch(`${origin}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: client.id, week_no: 1 })
      }).catch(() => {});
    }

    console.log(`[Exly] Converted ${maskPhone(cleanPhone)} -> ${program}`);
    return res.status(200).json({ success: true, client_id: client.id });
  } catch (err) {
    console.error('[Exly] Error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
