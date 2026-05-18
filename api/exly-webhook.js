const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, maskPhone } = require('../lib/whatsapp');
const { PROGRAM_DURATIONS } = require('../lib/classify');
const { detectMarket, isHinglish } = require('../lib/market');
const crypto = require('crypto');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    if (process.env.EXLY_WEBHOOK_SECRET) {
      const sig = req.headers['x-exly-signature'] || '';
      const expected = crypto
        .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (sig !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const { phone, name, email, product, amount, checkout_id } = req.body;

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    const db = getSupabase();

    const programMap = {
      '6_week_shred': '6wk_gym',
      '6_week_home': '6wk_home',
      '12_week_custom': '12wk',
      'pcos_warrior': 'pcos',
      '40_plus_strong': '40plus',
      'zoom_trial': 'zoom_trial',
      'zoom_pack': 'zoom_pack',
    };

    const program = programMap[product] || '6wk_gym';
    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const endsAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString();

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const folderPath = `clients/${checkout_id || crypto.randomUUID()}`;

    const { data: existingClient } = await db
      .from('clients')
      .select('id')
      .eq('phone', phone)
      .eq('program', program)
      .single();

    let clientId;

    if (existingClient) {
      await db.from('clients').update({
        status: 'active',
        paid_amount: amount,
        checkout_id,
        program_started_at: new Date().toISOString(),
        program_ends_at: endsAt,
        folder_url: folderPath,
      }).eq('id', existingClient.id);
      clientId = existingClient.id;
    } else {
      const { data: newClient } = await db.from('clients').insert({
        lead_id: lead?.id || null,
        phone,
        name: name || lead?.name,
        email,
        program,
        paid_amount: amount,
        checkout_id,
        status: 'active',
        program_started_at: new Date().toISOString(),
        program_ends_at: endsAt,
        folder_url: folderPath,
      }).select('id').single();
      clientId = newClient?.id;
    }

    const market = detectMarket(phone);
    const templateName = `onboard_${program}`;
    const msgParams = isHinglish(market)
      ? [`Welcome to FitnessByMaddy! Tera ${program.replace(/_/g, ' ')} program start ho gaya hai. Let's go!`]
      : [`Welcome to FitnessByMaddy! Your ${program.replace(/_/g, ' ')} program is now active. Let's go!`];

    await sendWhatsApp(phone, templateName, msgParams);

    if (program === '12wk' && clientId) {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://fitnessbymaddy.com';
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: clientId, week_no: 1 }),
        });
      } catch (e) {
        console.error('[exly] Program generation trigger failed:', e.message);
      }
    }

    return res.json({ success: true, client_id: clientId });
  } catch (err) {
    console.error('[exly-webhook]', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
