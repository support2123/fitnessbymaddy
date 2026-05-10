const { supabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');
const { detectMarket, isHinglish } = require('./lib/market');
const crypto = require('crypto');

const PROGRAM_DURATIONS = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 30
};

function verifyExlySignature(req) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true;
  const sig = req.headers['x-exly-signature'];
  if (!sig) return false;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(req.body))
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    if (!verifyExlySignature(req)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const { phone, name, email, program, amount, checkout_id } = req.body;
    if (!phone || !program) {
      return res.status(400).json({ error: 'phone and program required' });
    }

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (lead) {
      await supabase
        .from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const now = new Date();
    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const endsAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

    const { data: client, error } = await supabase
      .from('clients')
      .insert({
        lead_id: lead?.id || null,
        phone,
        name: name || lead?.name,
        email,
        program,
        program_started_at: now.toISOString(),
        program_ends_at: endsAt.toISOString(),
        paid_amount: amount,
        checkout_id,
        status: 'active'
      })
      .select()
      .single();

    if (error) throw error;

    const folderPath = `clients/${client.id}`;
    await supabase.storage.from('clients').upload(
      `${folderPath}/.keep`, new Uint8Array(0), { upsert: true }
    );

    await supabase
      .from('clients')
      .update({ folder_url: folderPath })
      .eq('id', client.id);

    const market = detectMarket(phone);
    const hinglish = isHinglish(market);

    const onboardMsg = hinglish
      ? `🎉 Welcome to the family! Aapka "${program}" program activate ho gaya hai.\n\nAapka pehla check-in Day 7 pe hoga. Tab tak — follow the plan, stay consistent! 💪`
      : `🎉 Welcome to the family! Your "${program}" program is now active.\n\nYour first check-in will be on Day 7. Until then — follow the plan, stay consistent! 💪`;

    await sendWhatsApp(phone, {
      template: `onboard_${program}`,
      params: [name || 'there'],
      isClient: true
    });

    if (program === '12wk') {
      const baseUrl = process.env.VERCEL_URL || 'fitnessbymaddy.com';
      await fetch(`https://${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: client.id, week_no: 1 })
      });
    }

    return res.json({ ok: true, clientId: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
