const crypto = require('crypto');
const { supabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');

const PROGRAM_DURATIONS = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 30
};

function verifyExlySignature(body, signature) {
  if (!process.env.EXLY_WEBHOOK_SECRET) return true;
  const expected = crypto
    .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
    .update(JSON.stringify(body))
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature || ''), Buffer.from(expected));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const signature = req.headers['x-exly-signature'];
    if (process.env.EXLY_WEBHOOK_SECRET && !verifyExlySignature(req.body, signature)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const {
      phone, name, email, program, amount, checkout_id
    } = req.body;

    if (!phone || !program) {
      return res.status(400).json({ error: 'phone and program required' });
    }

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (lead) {
      await supabase.from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const now = new Date();
    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const endsAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

    const { data: client, error } = await supabase.from('clients').insert({
      lead_id: lead ? lead.id : null,
      phone,
      name: name || (lead ? lead.name : null),
      email,
      program,
      program_started_at: now.toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: amount ? parseInt(amount) : null,
      checkout_id: checkout_id || null,
      folder_url: null,
      status: 'active'
    }).select().single();

    if (error) throw error;

    const folderPath = `clients/${client.id}`;
    await supabase.storage.from('programs').upload(
      `${folderPath}/.keep`,
      Buffer.from(''),
      { contentType: 'text/plain', upsert: true }
    );

    await supabase.from('clients')
      .update({ folder_url: folderPath })
      .eq('id', client.id);

    const market = lead ? lead.market : detectMarket(phone);
    const hinglish = isHinglish(market);
    const templateName = hinglish ? `onboard_${program}_hi` : `onboard_${program}`;

    await sendTemplate(phone, templateName, [
      client.name || 'there',
      durationDays.toString()
    ], true);

    // For 12-week program, trigger immediate Week 1 generation
    if (program === '12wk') {
      const generateUrl = `https://${req.headers.host}/api/generate-program`;
      fetch(generateUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: client.id, week_no: 1 })
      }).catch(err => console.error('Week 1 gen trigger failed:', err.message));
    }

    return res.status(200).json({ ok: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
