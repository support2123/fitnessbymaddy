const crypto = require('crypto');
const { getClient } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');

const PROGRAM_DURATIONS = {
  '6wk_gym': 42,
  '6wk_home': 42,
  'pcos': 42,
  '40plus': 42,
  '12wk': 84,
  'zoom_trial': 7,
  'zoom_pack': 30
};

function verifyWebhook(req) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true;

  const sig = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'] || '';
  const body = JSON.stringify(req.body);
  const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
  return sig === expected;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!verifyWebhook(req)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  try {
    const {
      phone, email, name, amount, checkout_id,
      product_name, product_id
    } = req.body;

    if (!phone) return res.status(400).json({ error: 'Phone required' });

    const db = getClient();

    // Map Exly product to our program key
    const productLower = (product_name || '').toLowerCase();
    let program = '6wk_gym';
    if (productLower.includes('home')) program = '6wk_home';
    else if (productLower.includes('pcos')) program = 'pcos';
    else if (productLower.includes('40')) program = '40plus';
    else if (productLower.includes('12') || productLower.includes('custom') || productLower.includes('flagship')) program = '12wk';
    else if (productLower.includes('trial')) program = 'zoom_trial';
    else if (productLower.includes('pack') || productLower.includes('zoom')) program = 'zoom_pack';

    // Find or create lead
    let { data: lead } = await db.from('leads').select('*').eq('phone', phone).single();
    if (!lead) {
      const { data: newLead } = await db.from('leads').insert({
        phone,
        name,
        source: 'exly',
        status: 'converted',
        market: detectMarket(phone)
      }).select().single();
      lead = newLead;
    } else {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    // Calculate program dates
    const startDate = new Date();
    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const endDate = new Date(startDate.getTime() + durationDays * 24 * 60 * 60 * 1000);

    // Create client record
    const { data: client } = await db.from('clients').insert({
      lead_id: lead.id,
      phone,
      name: name || lead.name,
      email,
      program,
      program_started_at: startDate.toISOString(),
      program_ends_at: endDate.toISOString(),
      paid_amount: amount ? parseInt(amount) : 0,
      checkout_id: checkout_id || product_id,
      status: 'active'
    }).select().single();

    // Create Supabase Storage folder
    await db.storage.from('clients').upload(
      `${client.id}/.keep`,
      new Uint8Array(0),
      { contentType: 'text/plain', upsert: true }
    );

    // Send onboarding WhatsApp
    const market = detectMarket(phone);
    const hinglish = isHinglish(market);
    const clientFirstName = (name || 'there').split(' ')[0];

    const onboardMsg = hinglish
      ? `Welcome aboard, ${clientFirstName}! 🎉\n\nTera ${program === '12wk' ? '12-Week Custom' : '6-Week'} program officially start ho gaya hai!\n\nYe raha tera check-in form — har week Sunday ko fill karna:\nhttps://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=1\n\nQuestions? Yahi message kar. Let's crush it! 💪`
      : `Welcome aboard, ${clientFirstName}! 🎉\n\nYour ${program === '12wk' ? '12-Week Custom' : '6-Week'} program officially starts today!\n\nHere's your weekly check-in form — fill it every Sunday:\nhttps://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=1\n\nGot questions? Just message here. Let's crush it! 💪`;

    await sendWhatsApp({
      phone,
      templateName: `onboard_${program}`,
      body: onboardMsg
    });

    // For 12-week: trigger immediate Week 1 program generation
    if (program === '12wk') {
      const baseUrl = `https://${req.headers.host}`;
      fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: client.id, week_no: 1 })
      }).catch(() => {});
    }

    return res.json({ success: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
