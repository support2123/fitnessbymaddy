const crypto = require('crypto');
const { getClient } = require('../lib/supabase');
const { sendMessage } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');

const PROGRAM_MAP = {
  '6_week_shred': '6wk_gym',
  '6_week_home': '6wk_home',
  '12_week_custom': '12wk',
  'pcos_warrior': 'pcos',
  '40_plus_strong': '40plus',
  'zoom_trial': 'zoom_trial',
  'zoom_pack': 'zoom_pack'
};

const PROGRAM_DURATION_WEEKS = {
  '6wk_gym': 6,
  '6wk_home': 6,
  '12wk': 12,
  'pcos': 8,
  '40plus': 8,
  'zoom_trial': 1,
  'zoom_pack': 4
};

function verifySignature(body, signature) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true;
  const expected = crypto.createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature || ''), Buffer.from(expected));
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const sig = req.headers['x-exly-signature'] || '';
    if (process.env.EXLY_WEBHOOK_SECRET && !verifySignature(req.body, sig)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const { phone, email, name, product_id, amount, checkout_id, lead_id } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone required' });

    const db = getClient();
    const program = PROGRAM_MAP[product_id] || '6wk_gym';
    const durationWeeks = PROGRAM_DURATION_WEEKS[program] || 6;
    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + durationWeeks * 7 * 24 * 60 * 60 * 1000);

    let resolvedLeadId = lead_id;
    if (!resolvedLeadId) {
      const { data: lead } = await db
        .from('leads')
        .select('id')
        .eq('phone', phone)
        .single();
      resolvedLeadId = lead?.id;
    }

    if (resolvedLeadId) {
      await db.from('leads').update({ status: 'converted' }).eq('id', resolvedLeadId);
    }

    const folderPath = `clients/${checkout_id || Date.now()}`;

    const { data: client, error } = await db.from('clients').insert({
      lead_id: resolvedLeadId || null,
      phone,
      name: name || null,
      email: email || null,
      program,
      program_started_at: startDate.toISOString(),
      program_ends_at: endDate.toISOString(),
      paid_amount: parseInt(amount) || 0,
      checkout_id: checkout_id || null,
      folder_url: folderPath,
      status: 'active'
    }).select().single();

    if (error) throw error;

    const market = detectMarket(phone);
    const hinglish = isHinglish(market);

    const onboardMsg = hinglish
      ? `Welcome to the family! 🎉 Tumhara ${program.replace(/_/g, ' ')} program officially start ho gaya hai.\n\nMaddy personally tumhara plan bana rahi hai. Week 1 plan jaldi aayega!\n\nKoi bhi question ho toh yahi message karo. 💪`
      : `Welcome to the family! 🎉 Your ${program.replace(/_/g, ' ')} program has officially started.\n\nMaddy is personally crafting your plan. Your Week 1 plan will be with you soon!\n\nGot questions? Just message here. 💪`;

    await sendMessage(phone, onboardMsg, {
      isClient: true,
      templateName: `onboard_${program}`,
      params: {
        name: name || 'there',
        templateParams: [name || 'there']
      }
    });

    if (program === '12wk') {
      const siteBase = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : (process.env.SITE_URL || 'https://fitnessbymaddy.com');

      fetch(`${siteBase}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: client.id, week_no: 1 })
      }).catch(err => console.error('Week-1 program gen failed:', err.message));
    }

    return res.status(200).json({ success: true, client_id: client.id });

  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
