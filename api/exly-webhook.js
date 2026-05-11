const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, detectMarket } = require('../lib/whatsapp');
const crypto = require('crypto');

const PROGRAM_MAP = {
  '6wk-burn-build': { program: '6wk_gym', weeks: 6, label: '6-Week Burn & Build' },
  '6wk-home': { program: '6wk_home', weeks: 6, label: '6-Week Home Shred' },
  '12wk-flagship': { program: '12wk', weeks: 12, label: '12-Week Flagship' },
  'pcos-warrior': { program: 'pcos', weeks: 6, label: 'PCOS Warrior' },
  '40plus-strong': { program: '40plus', weeks: 6, label: '40+ Strong' },
  'zoom-trial': { program: 'zoom_trial', weeks: 1, label: 'Zoom Trial' },
  'zoom-pack': { program: 'zoom_pack', weeks: 4, label: 'Zoom Pack' }
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const signature = req.headers['x-exly-signature'];
    if (process.env.EXLY_WEBHOOK_SECRET && signature) {
      const expected = crypto
        .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (signature !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const {
      customer_phone, customer_name, customer_email,
      product_slug, checkout_id, amount, currency
    } = req.body;

    const phone = normalizePhone(customer_phone);
    if (!phone) return res.status(400).json({ error: 'Missing customer phone' });

    const db = getSupabase();

    let lead = null;
    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (existingLead) {
      lead = existingLead;
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    } else {
      const { data: newLead } = await db.from('leads').insert({
        phone,
        name: customer_name,
        source: 'exly_direct',
        status: 'converted',
        market: detectMarket(phone)
      }).select('id').single();
      lead = newLead;
    }

    const programInfo = PROGRAM_MAP[product_slug] || {
      program: '12wk',
      weeks: 12,
      label: product_slug || 'Custom Program'
    };

    const programStarted = new Date();
    const programEnds = new Date(programStarted);
    programEnds.setDate(programEnds.getDate() + programInfo.weeks * 7);

    const folderPath = `clients/${lead.id}`;

    const { data: client } = await db.from('clients').insert({
      lead_id: lead.id,
      phone,
      name: customer_name || lead?.name,
      email: customer_email,
      program: programInfo.program,
      program_started_at: programStarted.toISOString(),
      program_ends_at: programEnds.toISOString(),
      paid_amount: amount || 0,
      checkout_id,
      folder_url: folderPath,
      status: 'active'
    }).select('id').single();

    const market = detectMarket(phone);
    const isHinglish = market === 'IN';

    const welcomeMsg = isHinglish
      ? `Welcome to the family! 🎉\n\n"${programInfo.label}" ke liye payment confirm ho gaya hai ✅\n\nAapka program ${programInfo.weeks} weeks ka hai. Pehla check-in Day 7 pe aayega.\n\nAgar intake form nahi bhara toh abhi bharo:\nhttps://www.fitnessbymaddy.com/intake?lead=${lead.id}\n\nLet's go! 💪`
      : `Welcome to the family! 🎉\n\nYour payment for "${programInfo.label}" is confirmed ✅\n\nYour ${programInfo.weeks}-week program starts now. Your first check-in will be on Day 7.\n\nIf you haven't filled the intake form yet:\nhttps://www.fitnessbymaddy.com/intake?lead=${lead.id}\n\nLet's go! 💪`;

    await sendWhatsApp({ phone, body: welcomeMsg, templateName: `onboard_${programInfo.program}` });

    if (programInfo.program === '12wk') {
      await triggerWeek1Generation(client.id);
    }

    return res.json({ success: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function normalizePhone(phone) {
  if (!phone) return null;
  let cleaned = phone.replace(/[^0-9+]/g, '');
  if (!cleaned.startsWith('+')) cleaned = '+' + cleaned;
  return cleaned;
}

async function triggerWeek1Generation(clientId) {
  try {
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'https://www.fitnessbymaddy.com';

    await fetch(`${baseUrl}/api/generate-program`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`
      },
      body: JSON.stringify({ client_id: clientId, week_no: 1 })
    });
  } catch (err) {
    console.error('Week 1 generation trigger failed:', err.message);
  }
}
