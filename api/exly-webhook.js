const { supabase } = require('./lib/supabase');
const { sendTemplate } = require('./lib/whatsapp');
const crypto = require('crypto');

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
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify webhook signature
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

  try {
    const { phone, email, name, product_id, amount, checkout_id } = req.body;
    if (!phone) {
      return res.status(400).json({ error: 'Phone required' });
    }

    const cleanPhone = phone.replace(/[^0-9]/g, '');

    // Find existing lead
    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', cleanPhone)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    const program = lead?.program_interest || mapProductToProgram(product_id);
    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const endsAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString();

    // Create client
    const { data: client } = await supabase.from('clients').insert({
      lead_id: lead?.id || null,
      phone: cleanPhone,
      name: name || lead?.name || null,
      email: email || null,
      program,
      program_started_at: new Date().toISOString(),
      program_ends_at: endsAt,
      paid_amount: amount || 0,
      checkout_id: checkout_id || null,
      folder_url: `/clients/${crypto.randomUUID()}`,
      status: 'active'
    }).select().single();

    // Update lead status
    if (lead) {
      await supabase.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    // Send onboarding template
    const market = lead?.market || 'IN';
    const templateName = `onboard_${program}`;
    const params = market === 'IN'
      ? [`Welcome aboard! 🎉 Aapka ${program.replace('_', ' ')} program start ho gaya hai. First check-in Day 7 pe aayega.`]
      : [`Welcome aboard! 🎉 Your ${program.replace('_', ' ')} program has started. First check-in coming on Day 7.`];

    await sendTemplate(cleanPhone, templateName, params);

    // For 12-week program, trigger immediate program generation
    if (program === '12wk') {
      await fetch(`${process.env.VERCEL_URL || 'https://www.fitnessbymaddy.com'}/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-key': process.env.INTERNAL_API_KEY
        },
        body: JSON.stringify({ client_id: client.id, week_no: 1 })
      });
    }

    return res.status(200).json({ success: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function mapProductToProgram(productId) {
  const map = {
    'shred': '6wk_gym', '6wk': '6wk_gym', 'home': '6wk_home',
    '12wk': '12wk', 'custom': '12wk', 'pcos': 'pcos',
    '40plus': '40plus', 'trial': 'zoom_trial', 'zoom': 'zoom_pack'
  };
  if (!productId) return '6wk_gym';
  const lower = productId.toLowerCase();
  for (const [key, val] of Object.entries(map)) {
    if (lower.includes(key)) return val;
  }
  return '6wk_gym';
}
