const crypto = require('crypto');
const { getSupabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');

const PROGRAM_MAP = {
  'shred-gym': '6wk_gym',
  'shred-home': '6wk_home',
  'custom-12wk': '12wk',
  'pcos': 'pcos',
  '40plus': '40plus',
  'zoom-trial': 'zoom_trial',
  'zoom-pack': 'zoom_pack'
};

const PROGRAM_DURATIONS = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 28
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (secret) {
    const sig = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'] || '';
    const expected = crypto.createHmac('sha256', secret).update(JSON.stringify(req.body)).digest('hex');
    if (sig && sig !== expected) {
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }

  const db = getSupabase();

  try {
    const {
      phone, email, name, amount, checkout_id,
      product_id, product_name, status
    } = req.body;

    if (status && status !== 'completed' && status !== 'success') {
      if (status === 'failed') {
        const { data: client } = await db
          .from('clients')
          .select('phone, name')
          .eq('phone', phone)
          .single();
        if (client) {
          const { notifyMaddy } = require('../lib/escalation');
          await notifyMaddy('Payment failed', `${name || phone} — checkout ${checkout_id}`);
        }
      }
      return res.status(200).json({ action: 'non_completed_status' });
    }

    const program = PROGRAM_MAP[product_id] || PROGRAM_MAP[product_name] || '12wk';
    const durationDays = PROGRAM_DURATIONS[program] || 42;

    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + durationDays * 24 * 60 * 60 * 1000);

    const { data: lead } = await db
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .single();

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const { data: client, error } = await db.from('clients').insert({
      lead_id: lead?.id || null,
      phone,
      name,
      email,
      program,
      program_started_at: startDate.toISOString(),
      program_ends_at: endDate.toISOString(),
      paid_amount: parseInt(amount) || 0,
      checkout_id,
      folder_url: `/clients/${phone.replace(/\+/g, '')}`,
      status: 'active'
    }).select().single();

    if (error) throw error;

    await sendTemplate(phone, `onboard_${program}`);

    if (program === '12wk') {
      try {
        const baseUrl = `https://${req.headers.host || 'fitnessbymaddy.com'}`;
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (e) {
        console.error('Initial program generation failed:', e.message);
      }
    }

    return res.status(200).json({ success: true, client_id: client.id });

  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
