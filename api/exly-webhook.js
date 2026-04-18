const crypto = require('crypto');
const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp, detectMarket, isHinglish } = require('./lib/whatsapp');

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

    const { phone, name, email, checkout_id, program, amount } = req.body;
    if (!phone || !program) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const cleanPhone = phone.replace(/\D/g, '');
    const db = getSupabase();

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', cleanPhone)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const programEnds = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000);

    const { data: client, error } = await db.from('clients').insert({
      lead_id: lead ? lead.id : null,
      phone: cleanPhone,
      name: name || (lead ? lead.name : null),
      email,
      program,
      program_started_at: new Date().toISOString(),
      program_ends_at: programEnds.toISOString(),
      paid_amount: amount ? parseInt(amount) : null,
      checkout_id,
      status: 'active'
    }).select().single();

    if (error) throw error;

    const folderPath = `${client.id}/`;
    await db.storage.from('clients').upload(`${folderPath}.keep`, '', {
      contentType: 'text/plain',
      upsert: true
    });

    await db.from('clients').update({
      folder_url: folderPath
    }).eq('id', client.id);

    const market = detectMarket(cleanPhone);
    const hinglish = isHinglish(market);

    const welcomeParams = hinglish
      ? [name || 'there', program]
      : [name || 'there', program];
    await sendWhatsApp(cleanPhone, `onboard_${program}`, welcomeParams);

    if (program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://fitnessbymaddy.com';
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (genErr) {
        console.error('Week 1 program generation failed:', genErr.message);
      }
    }

    return res.status(200).json({ success: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
