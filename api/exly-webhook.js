const crypto = require('crypto');
const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');

const PROGRAM_DURATIONS = {
  '6wk_gym': 42, '6wk_home': 42,
  '12wk': 84,
  'pcos': 42, '40plus': 42,
  'zoom_trial': 7, 'zoom_pack': 30
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    if (process.env.EXLY_WEBHOOK_SECRET) {
      const sig = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'] || '';
      const expected = crypto
        .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
        .update(JSON.stringify(req.body))
        .digest('hex');

      if (sig && sig !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const {
      phone, email, name, checkout_id,
      product_name, amount, status
    } = req.body;

    if (status && status !== 'completed' && status !== 'paid') {
      return res.status(200).json({ action: 'ignored_status', status });
    }

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone' });
    }

    const db = getSupabase();

    const program = detectProgram(product_name || '');

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .maybeSingle();

    if (lead) {
      await db.from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const now = new Date();
    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const endsAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

    const { data: client, error } = await db.from('clients').insert({
      lead_id: lead?.id || null,
      phone,
      name: name || lead?.name || null,
      email: email || null,
      program,
      program_started_at: now.toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: parseInt(amount) || 0,
      checkout_id: checkout_id || null,
      folder_url: null,
      status: 'active'
    }).select().single();

    if (error) {
      console.error('Client insert error:', error.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    const folderPath = `clients/${client.id}`;
    await db.storage.from('clients').upload(`${folderPath}/.keep`, new Blob(['']));
    await db.from('clients')
      .update({ folder_url: folderPath })
      .eq('id', client.id);

    await sendWhatsApp({
      phone,
      templateName: `onboard_${program}`,
      body: buildWelcomeMessage(name || 'there', program)
    });

    if (program === '12wk') {
      try {
        const origin = `https://${req.headers?.host || 'fitnessbymaddy.com'}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (e) {
        console.error('Week 1 program generation trigger failed:', e.message);
      }
    }

    return res.status(200).json({ success: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function detectProgram(productName) {
  const lower = (productName || '').toLowerCase();
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40+') || lower.includes('40 plus')) return '40plus';
  if (lower.includes('12') || lower.includes('flagship') || lower.includes('custom')) return '12wk';
  if (lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('zoom') && lower.includes('pack')) return 'zoom_pack';
  if (lower.includes('home')) return '6wk_home';
  return '6wk_gym';
}

function buildWelcomeMessage(name, program) {
  const base = `Welcome to Fitness by Maddy, ${name}! You're officially in.`;
  const messages = {
    '6wk_gym': `${base}\n\nYour 6-Week Burn & Build program starts now. Check your email for the full plan. Let's crush it!`,
    '6wk_home': `${base}\n\nYour 6-Week Home Shred is ready. No gym needed — just you and the plan. Check your email!`,
    '12wk': `${base}\n\nYour 12-Week Custom program is being built just for you. Your Week 1 plan will arrive shortly. Fill out the intake form if you haven't already!`,
    'pcos': `${base}\n\nYour PCOS Warrior program starts now. This is designed specifically for hormonal balance and sustainable results. Check your email!`,
    '40plus': `${base}\n\nYour 40+ Strong program is ready. Joint-friendly, effective, and built for real life. Check your email for details!`,
    'zoom_trial': `${base}\n\nYour trial Zoom session will be scheduled within 48 hours. Keep an eye on your WhatsApp!`,
    'zoom_pack': `${base}\n\nYour Zoom sessions are booked. Scheduling details coming to your WhatsApp soon!`
  };
  return messages[program] || base;
}
