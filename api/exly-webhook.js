const crypto = require('crypto');
const supabase = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { detectMarket, isHinglishMarket } = require('../lib/market');

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
      phone, name, email, program, amount,
      checkout_id, transaction_id
    } = req.body;

    if (!phone || !program) {
      return res.status(400).json({ error: 'phone and program required' });
    }

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .maybeSingle();

    if (lead) {
      await supabase.from('leads').update({
        status: 'converted',
        last_msg_at: new Date().toISOString()
      }).eq('id', lead.id);
    }

    const now = new Date();
    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const endsAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

    const { data: client, error } = await supabase.from('clients').upsert({
      lead_id: lead ? lead.id : null,
      phone,
      name: name || (lead ? lead.name : null),
      email,
      program,
      program_started_at: now.toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: parseInt(amount) || 0,
      checkout_id: checkout_id || transaction_id || null,
      folder_url: '/clients/' + phone.replace(/[^0-9]/g, '') + '/',
      status: 'active'
    }, { onConflict: 'phone' }).select().single();

    if (error) {
      console.error('Client upsert error:', error.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    const market = detectMarket(phone);
    const templateName = isHinglishMarket(market)
      ? 'onboard_' + program
      : 'onboard_' + program + '_en';

    await sendTemplate(phone, templateName, [
      name || 'there',
      durationDays + ' days'
    ], name || '');

    if (program === '12wk') {
      try {
        const baseUrl = 'https://' + (req.headers.host || 'fitnessbymaddy.com');
        await fetch(baseUrl + '/api/generate-program', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (genErr) {
        console.error('Week-1 program generation failed:', genErr.message);
      }
    }

    return res.status(200).json({ status: 'converted', client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
};
