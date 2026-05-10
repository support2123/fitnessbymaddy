const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');
const crypto = require('crypto');

const PROGRAM_DURATION = {
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
    const secret = process.env.EXLY_WEBHOOK_SECRET;
    if (secret) {
      const sig = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'] || '';
      const rawBody = JSON.stringify(req.body);
      const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
      if (sig && sig !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const {
      phone, email, name, amount, checkout_id,
      product_name, product_id, status
    } = req.body || {};

    if (!phone) {
      return res.status(400).json({ error: 'Phone is required' });
    }

    if (status && status !== 'completed' && status !== 'success') {
      const db = getSupabase();
      const { data: client } = await db
        .from('clients')
        .select('id, name, phone')
        .eq('phone', phone)
        .eq('status', 'active')
        .single();

      if (client) {
        const { escalateToMaddy } = require('../lib/escalation');
        await escalateToMaddy({
          reason: 'Payment failure for active client',
          phone,
          clientName: client.name || name,
          message: `Payment failed: ${amount} for ${product_name}`
        });
      }
      return res.status(200).json({ action: 'payment_failed_logged' });
    }

    const db = getSupabase();

    const program = detectProgram(product_name, product_id);
    const durationDays = PROGRAM_DURATION[program] || 42;
    const now = new Date();
    const endsAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const folderPath = `clients/${crypto.randomUUID()}`;

    const { data: client } = await db.from('clients').insert({
      lead_id: lead?.id || null,
      phone,
      name: name || lead?.name || null,
      email: email || null,
      program,
      program_started_at: now.toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: amount || 0,
      checkout_id: checkout_id || product_id || null,
      folder_url: folderPath,
      status: 'active'
    }).select().single();

    const market = lead?.market || detectMarket(phone);
    const hinglish = isHinglish(market);
    const templateName = `onboard_${program}`;

    await sendWhatsApp({
      phone,
      templateName,
      params: [name || 'there'],
      body: hinglish
        ? `Welcome to FitnessByMaddy! Tumhara ${product_name || program} program shuru ho gaya hai. First check-in Day 7 pe hoga.`
        : `Welcome to FitnessByMaddy! Your ${product_name || program} program has started. Your first check-in will be on Day 7.`
    });

    if (program === '12wk' && client) {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://www.fitnessbymaddy.com';
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (err) {
        console.error('Failed to trigger Week-1 program generation:', err.message);
      }
    }

    return res.status(200).json({
      success: true,
      clientId: client?.id,
      action: 'converted'
    });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function detectProgram(productName, productId) {
  const name = (productName || productId || '').toLowerCase();
  if (name.includes('12') || name.includes('flagship') || name.includes('custom')) return '12wk';
  if (name.includes('pcos')) return 'pcos';
  if (name.includes('40') || name.includes('plus')) return '40plus';
  if (name.includes('home')) return '6wk_home';
  if (name.includes('trial') || name.includes('zoom')) return 'zoom_trial';
  if (name.includes('shred') || name.includes('burn') || name.includes('6')) return '6wk_gym';
  return '6wk_gym';
}
