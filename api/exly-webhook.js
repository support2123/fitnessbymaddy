const crypto = require('crypto');
const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');
const { detectMarket, isHinglishMarket } = require('./lib/market');

const PROGRAM_DURATIONS = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  pcos: 42,
  '40plus': 42,
  zoom_trial: 7,
  zoom_pack: 30,
};

function verifyExlySignature(body, signature) {
  if (!process.env.EXLY_WEBHOOK_SECRET) return true;
  const computed = crypto
    .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
    .update(JSON.stringify(body))
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(signature || ''));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getSupabase();

  try {
    const signature = req.headers['x-exly-signature'];
    if (process.env.EXLY_WEBHOOK_SECRET && !verifyExlySignature(req.body, signature)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const { phone, name, email, product, amount, checkout_id } = req.body;

    if (!phone || !product) {
      return res.status(400).json({ error: 'Missing phone or product' });
    }

    const programKey = product.toLowerCase().replace(/[^a-z0-9_]/g, '_');
    const program = Object.keys(PROGRAM_DURATIONS).find(
      (p) => programKey.includes(p) || p.includes(programKey)
    ) || '6wk_gym';

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (lead) {
      await db.from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + durationDays * 24 * 60 * 60 * 1000);

    const { data: client, error: insertErr } = await db
      .from('clients')
      .insert({
        lead_id: lead?.id || null,
        phone,
        name: name || lead?.name,
        email,
        program,
        program_started_at: startDate.toISOString(),
        program_ends_at: endDate.toISOString(),
        paid_amount: amount ? parseInt(amount) : null,
        checkout_id,
        folder_url: null,
        status: 'active',
      })
      .select()
      .single();

    if (insertErr) throw insertErr;

    const folderPath = `clients/${client.id}`;
    await db.storage.from('client-files').upload(
      `${folderPath}/.keep`,
      new Uint8Array([0]),
      { contentType: 'application/octet-stream', upsert: true }
    );

    await db
      .from('clients')
      .update({ folder_url: folderPath })
      .eq('id', client.id);

    const market = lead?.market || detectMarket(phone);
    const hinglish = isHinglishMarket(market);

    const welcomeMsg = hinglish
      ? `Welcome to FitnessByMaddy! Aapka ${program.replace(/_/g, ' ')} program start ho gaya hai.\n\nHar week Sunday ko aapko ek check-in form milega — weight, waist, photos bharna hoga.\n\nLet's crush this!`
      : `Welcome to FitnessByMaddy! Your ${program.replace(/_/g, ' ')} program has officially started.\n\nEvery Sunday you'll receive a check-in form — submit your weight, waist, and progress photos.\n\nLet's get to work!`;

    await sendWhatsApp(phone, welcomeMsg, `onboard_${program}`);

    if (program === '12wk') {
      try {
        const origin = `https://${req.headers.host}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch (genErr) {
        console.error('Week 1 program generation failed:', genErr.message);
      }
    }

    return res.status(200).json({ success: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
