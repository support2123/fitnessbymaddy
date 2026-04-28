const { getSupabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { isHinglish } = require('../lib/market');
const crypto = require('crypto');

const PROGRAM_MAP = {
  '6wk_gym': { weeks: 6, name: '6-Week Burn & Build (Gym)' },
  '6wk_home': { weeks: 6, name: '6-Week Burn & Build (Home)' },
  '12wk': { weeks: 12, name: '12-Week Flagship' },
  'pcos': { weeks: 8, name: 'PCOS Warrior' },
  '40plus': { weeks: 8, name: '40+ Strong' },
  'zoom_trial': { weeks: 1, name: 'Zoom Trial' },
  'zoom_pack': { weeks: 4, name: 'Zoom Pack' }
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

  try {
    const {
      phone, name, email, program, amount, checkout_id,
      signature
    } = req.body;

    if (process.env.EXLY_WEBHOOK_SECRET && signature) {
      const expected = crypto
        .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
        .update(checkout_id || '')
        .digest('hex');
      if (signature !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    if (!phone || !program) {
      return res.status(400).json({ error: 'phone and program required' });
    }

    const programInfo = PROGRAM_MAP[program];
    if (!programInfo) return res.status(400).json({ error: 'Unknown program' });

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const startDate = new Date();
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + programInfo.weeks * 7);

    const { data: client, error } = await db.from('clients').insert({
      lead_id: lead?.id || null,
      phone,
      name: name || lead?.name || null,
      email: email || null,
      program,
      program_started_at: startDate.toISOString(),
      program_ends_at: endDate.toISOString(),
      paid_amount: amount ? parseInt(amount) : null,
      checkout_id: checkout_id || null,
      folder_url: null,
      status: 'active'
    }).select().single();

    if (error) throw error;

    const folderPath = `${client.id}/`;
    await db.storage.from('clients').upload(
      `${folderPath}.keep`,
      new Uint8Array(0),
      { contentType: 'text/plain', upsert: true }
    );

    await db.from('clients').update({
      folder_url: `/clients/${client.id}/`
    }).eq('id', client.id);

    const market = lead?.market || 'GLOBAL';
    const onboardMsg = isHinglish(market)
      ? [`Welcome to ${programInfo.name}! Aapka program start ho gaya hai. Week 1 ka check-in form Day 7 ko aayega. Let's crush it!`]
      : [`Welcome to ${programInfo.name}! Your program has started. You'll receive your Week 1 check-in form on Day 7. Let's do this!`];

    await sendTemplate(phone, `onboard_${program}`, onboardMsg);

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

    return res.json({ success: true, client_id: client.id });

  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
