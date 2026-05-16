const { supabase } = require('./lib/supabase');
const { sendWhatsApp, notifyMaddy } = require('./lib/whatsapp');
const crypto = require('crypto');

const PROGRAM_MAP = {
  '6wk-gym': '6wk_gym',
  '6wk-home': '6wk_home',
  '12wk-custom': '12wk',
  'pcos': 'pcos',
  '40plus': '40plus',
  'zoom-trial': 'zoom_trial',
  'zoom-pack': 'zoom_pack',
};

const PROGRAM_DURATION_WEEKS = {
  '6wk_gym': 6,
  '6wk_home': 6,
  '12wk': 12,
  'pcos': 8,
  '40plus': 8,
  'zoom_trial': 1,
  'zoom_pack': 4,
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    if (process.env.EXLY_WEBHOOK_SECRET) {
      const sig = req.headers['x-exly-signature'];
      const expected = crypto
        .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (sig && sig !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const { phone, email, name, product_id, amount, checkout_id } = req.body;

    if (!phone) return res.status(400).json({ error: 'Phone required' });

    const program = PROGRAM_MAP[product_id] || '6wk_gym';
    const durationWeeks = PROGRAM_DURATION_WEEKS[program] || 6;
    const endsAt = new Date();
    endsAt.setDate(endsAt.getDate() + durationWeeks * 7);

    let lead;
    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (existingLead) {
      await supabase.from('leads')
        .update({ status: 'converted' })
        .eq('id', existingLead.id);
      lead = existingLead;
    } else {
      const { data: newLead } = await supabase.from('leads').insert({
        phone, name, source: 'exly_direct', status: 'converted',
      }).select().single();
      lead = newLead;
    }

    const { data: client, error } = await supabase.from('clients').insert({
      lead_id: lead.id,
      phone,
      name: name || lead.name,
      email,
      program,
      program_started_at: new Date().toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: amount ? parseInt(amount) : null,
      checkout_id,
      folder_url: `/clients/${lead.id}/`,
      status: 'active',
    }).select().single();

    if (error) throw error;

    const welcomeMsg = program === 'zoom_trial'
      ? 'Welcome aboard! 🎉 Your Zoom trial session will be scheduled within 24 hours. Get ready!'
      : `Welcome to the ${program.replace(/_/g, ' ')} program! 🎉 Your journey starts NOW. Week 1 plan coming soon.`;

    await sendWhatsApp({
      phone,
      templateName: `onboard_${program}`,
      params: [welcomeMsg],
    });

    if (program === '12wk') {
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'https://www.fitnessbymaddy.com';

      await fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: client.id, week_no: 1 }),
      }).catch(() => {});
    }

    return res.status(200).json({ success: true, client_id: client.id });

  } catch (err) {
    console.error('Exly webhook error:', err.message);
    if (err.message?.includes('payment') || err.message?.includes('fail')) {
      await notifyMaddy(`Payment issue for new signup: ${err.message}`);
    }
    return res.status(500).json({ error: 'Internal error' });
  }
};
