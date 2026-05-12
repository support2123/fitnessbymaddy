const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, notifyMaddy } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');
const crypto = require('crypto');

const PROGRAM_DURATION = {
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

  // Verify webhook signature if secret is configured
  if (process.env.EXLY_WEBHOOK_SECRET) {
    const sig = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'] || '';
    const expected = crypto
      .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
      .update(JSON.stringify(req.body))
      .digest('hex');
    if (sig !== expected) {
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }

  const db = getSupabase();
  const {
    phone, email, name, amount, checkout_id,
    product_name, product_id, status
  } = req.body;

  if (status && status !== 'paid' && status !== 'completed') {
    // Payment failure for a known lead
    if (status === 'failed') {
      const { data: existingClient } = await db
        .from('clients')
        .select('*')
        .eq('checkout_id', checkout_id)
        .single();

      if (existingClient) {
        await notifyMaddy(
          'Payment Failed — Active Client',
          `Client: ${name || phone}\nCheckout: ${checkout_id}\nAmount: $${amount || '?'}`
        );
      }
    }
    return res.status(200).json({ status: 'non_payment_event' });
  }

  if (!phone) return res.status(400).json({ error: 'phone is required' });

  const normalPhone = phone.startsWith('+') ? phone : '+' + phone.replace(/[^0-9]/g, '');

  // Detect program from product
  let program = '6wk_gym';
  const pName = (product_name || '').toLowerCase();
  if (pName.includes('12') || pName.includes('custom') || pName.includes('flagship')) program = '12wk';
  else if (pName.includes('pcos')) program = 'pcos';
  else if (pName.includes('40') || pName.includes('plus')) program = '40plus';
  else if (pName.includes('home')) program = '6wk_home';
  else if (pName.includes('trial') || pName.includes('zoom')) program = 'zoom_trial';
  else if (pName.includes('pack')) program = 'zoom_pack';

  const durationDays = PROGRAM_DURATION[program] || 42;
  const now = new Date();
  const endsAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

  // Find or create lead
  let { data: lead } = await db.from('leads').select('*').eq('phone', normalPhone).single();
  if (!lead) {
    const { data: newLead } = await db.from('leads').insert({
      phone: normalPhone,
      name,
      source: 'exly',
      status: 'converted',
      market: detectMarket(normalPhone)
    }).select().single();
    lead = newLead;
  } else {
    await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
  }

  // Create client
  const { data: client, error } = await db.from('clients').insert({
    lead_id: lead.id,
    phone: normalPhone,
    name: name || lead.name,
    email,
    program,
    program_started_at: now.toISOString(),
    program_ends_at: endsAt.toISOString(),
    paid_amount: amount ? parseInt(amount) : 0,
    checkout_id,
    status: 'active'
  }).select().single();

  if (error) {
    console.error('Client creation error:', error.message);
    return res.status(500).json({ error: 'Failed to create client' });
  }

  // Create storage folder
  const folderPath = `clients/${client.id}/`;
  await db.storage.from('clients').upload(
    `${client.id}/.keep`,
    new Uint8Array(0),
    { contentType: 'application/octet-stream', upsert: true }
  );
  await db.from('clients').update({ folder_url: folderPath }).eq('id', client.id);

  // Send onboarding WhatsApp
  const market = detectMarket(normalPhone);
  const hinglish = isHinglish(market);

  let onboardBody;
  if (hinglish) {
    onboardBody = `Welcome to Fitness by Maddy! 🎉\n\n${name || 'Hi'}, aapka ${program.replace('_', ' ')} program start ho gaya hai.\n\nPehla check-in Day 7 ko aayega. Tab tak plan follow karo aur koi question ho toh poochho!\n\nLet's crush it 💪`;
  } else {
    onboardBody = `Welcome to Fitness by Maddy! 🎉\n\n${name || 'Hi'}, your ${program.replace('_', ' ')} program is now active.\n\nYour first check-in will be on Day 7. Follow the plan and reach out with any questions!\n\nLet's do this 💪`;
  }

  await sendWhatsApp({
    phone: normalPhone,
    templateName: `onboard_${program}`,
    body: onboardBody,
    isClient: true
  });

  // For 12-week program: generate Week 1 immediately
  if (program === '12wk') {
    try {
      const baseUrl = `https://${req.headers.host}`;
      await fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`
        },
        body: JSON.stringify({ client_id: client.id, week_no: 1 })
      });
    } catch (err) {
      console.error('Week 1 program generation failed:', err.message);
    }
  }

  return res.status(200).json({ success: true, client_id: client.id, program });
};
