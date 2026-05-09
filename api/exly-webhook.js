const crypto = require('crypto');
const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');

const PROGRAM_MAP = {
  '6_week_shred': '6wk_gym',
  '6_week_home': '6wk_home',
  '12_week_custom': '12wk',
  'pcos_warrior': 'pcos',
  '40_plus': '40plus',
  'zoom_trial': 'zoom_trial',
  'zoom_pack': 'zoom_pack'
};

const PROGRAM_DURATIONS = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 30
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const secret = process.env.EXLY_WEBHOOK_SECRET;
    if (secret && req.headers['x-exly-signature']) {
      const sig = crypto.createHmac('sha256', secret)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (sig !== req.headers['x-exly-signature']) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const db = getSupabase();
    const {
      customer_phone, customer_name, customer_email,
      product_name, amount, checkout_id
    } = req.body;

    if (!customer_phone) {
      return res.status(400).json({ error: 'Missing customer_phone' });
    }

    const phone = customer_phone.replace(/[^0-9]/g, '');
    const program = PROGRAM_MAP[product_name] || '12wk';
    const market = detectMarket(phone);
    const hinglish = isHinglish(market);

    const { data: lead } = await db
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .maybeSingle();

    const leadId = lead?.id;
    if (leadId) {
      await db.from('leads').update({ status: 'converted' }).eq('id', leadId);
    }

    const now = new Date();
    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const endDate = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

    const { data: newClient, error: insertErr } = await db
      .from('clients')
      .insert({
        lead_id: leadId,
        phone,
        name: customer_name,
        email: customer_email,
        program,
        program_started_at: now.toISOString(),
        program_ends_at: endDate.toISOString(),
        paid_amount: amount ? parseInt(amount, 10) : null,
        checkout_id,
        folder_url: null,
        status: 'active'
      })
      .select('id')
      .single();

    if (insertErr) {
      console.error('Client insert error:', insertErr.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    const folderPath = `clients/${newClient.id}`;
    await db.storage.from('client-files').upload(
      `${folderPath}/.keep`,
      new Uint8Array([]),
      { contentType: 'application/octet-stream', upsert: true }
    );
    await db.from('clients').update({ folder_url: folderPath }).eq('id', newClient.id);

    const welcome = hinglish
      ? `Welcome to FitnessByMaddy! 🎉\n\nAapka ${program} program start ho gaya hai. Maddy aapke saath hai — ab results aayenge!\n\nPehla check-in Day 7 pe hoga. Tab tak plan follow karo aur doubts ho toh message karo.`
      : `Welcome to FitnessByMaddy! 🎉\n\nYour ${program} program is now active. Maddy's got your back — results are coming!\n\nYour first check-in will be on Day 7. Follow the plan and message us with any questions.`;

    await sendWhatsApp({ phone, message: welcome, templateName: `onboard_${program}` });

    if (program === '12wk') {
      try {
        const origin = `https://${req.headers.host}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: newClient.id, week_no: 1 })
        });
      } catch (e) {
        console.error('Week-1 program generation failed:', e.message);
      }
    }

    return res.status(200).json({ ok: true, client_id: newClient.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
};
