const crypto = require('crypto');
const { getSupabase } = require('./lib/supabase');
const { sendTemplate, sendText, detectMarket } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const signature = req.headers['x-exly-signature'];
  const secret = process.env.EXLY_WEBHOOK_SECRET;

  if (secret && signature) {
    const expected = crypto
      .createHmac('sha256', secret)
      .update(JSON.stringify(req.body))
      .digest('hex');
    if (signature !== expected) {
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }

  try {
    const { phone, email, name, amount, checkout_id, product_name } = req.body;
    const db = getSupabase();

    const normalizedPhone = phone.startsWith('+') ? phone : '+' + phone;

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', normalizedPhone)
      .limit(1)
      .single();

    const program = mapProductToProgram(product_name, lead?.program_interest);

    const programDuration = {
      '6wk_gym': 42,
      '6wk_home': 42,
      '12wk': 84,
      'pcos': 42,
      '40plus': 42,
      'zoom_trial': 7,
      'zoom_pack': 30
    };

    const durationDays = programDuration[program] || 42;
    const startDate = new Date();
    const endDate = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000);

    const { data: client, error } = await db.from('clients').insert({
      lead_id: lead?.id || null,
      phone: normalizedPhone,
      name: name || lead?.name || 'Unknown',
      email: email || null,
      program,
      program_started_at: startDate.toISOString(),
      program_ends_at: endDate.toISOString(),
      paid_amount: amount || 0,
      checkout_id: checkout_id || null,
      status: 'active'
    }).select().single();

    if (error) throw error;

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const market = detectMarket(normalizedPhone);
    const welcomeMsg = market === 'IN'
      ? `Welcome to the family! 🎉 Aapka ${getReadableProgramName(program)} officially start ho gaya hai.\n\nDay 7 pe aapko pehla check-in form milega. Tab tak — let's crush it! 💪`
      : `Welcome to the family! 🎉 Your ${getReadableProgramName(program)} has officially started.\n\nYou'll receive your first check-in form on Day 7. Until then — let's crush it! 💪`;

    await sendText(normalizedPhone, welcomeMsg);

    if (program === '12wk') {
      await triggerProgramGeneration(client.id, 1);
    }

    return res.status(200).json({ ok: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function mapProductToProgram(productName, leadInterest) {
  if (leadInterest) return leadInterest;
  if (!productName) return '6wk_gym';

  const lower = productName.toLowerCase();
  if (lower.includes('12') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40')) return '40plus';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('trial') || lower.includes('zoom')) return 'zoom_trial';
  return '6wk_gym';
}

function getReadableProgramName(program) {
  const names = {
    '6wk_gym': '6-Week Burn & Build',
    '6wk_home': '6-Week Home Workout',
    '12wk': '12-Week Custom Program',
    'pcos': 'PCOS Warrior Program',
    '40plus': '40+ Strong Program',
    'zoom_trial': 'Zoom Trial Session',
    'zoom_pack': 'Zoom Pack'
  };
  return names[program] || program;
}

async function triggerProgramGeneration(clientId, weekNo) {
  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'https://fitnessbymaddy.com';

  await fetch(`${baseUrl}/api/generate-program`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, week_no: weekNo })
  }).catch(() => {});
}
