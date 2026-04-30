const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');
const { isHinglishMarket } = require('./lib/market');
const crypto = require('crypto');

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
      customer_phone, customer_name, customer_email,
      product_name, amount, checkout_id, status
    } = req.body;

    if (status !== 'completed' && status !== 'success') {
      if (status === 'failed') {
        await handlePaymentFailure(customer_phone, customer_name);
      }
      return res.status(200).json({ status: 'ignored', reason: `status=${status}` });
    }

    const phone = normalizePhone(customer_phone);
    if (!phone) return res.status(400).json({ error: 'No phone number' });

    const db = getSupabase();
    const program = detectProgram(product_name, amount);

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    const leadId = lead?.id || null;
    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const programDays = program === '12wk' ? 84 : 42;
    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + programDays * 24 * 60 * 60 * 1000);

    const { data: client } = await db.from('clients').insert({
      lead_id: leadId,
      phone,
      name: customer_name,
      email: customer_email,
      program,
      program_started_at: startDate.toISOString(),
      program_ends_at: endDate.toISOString(),
      paid_amount: parseFloat(amount) || 0,
      checkout_id: checkout_id || null,
      folder_url: null,
      status: 'active'
    }).select().single();

    const folderPath = `clients/${client.id}`;
    await db.storage.from('client-files').upload(
      `${folderPath}/.keep`,
      new Uint8Array([]),
      { upsert: true }
    );
    await db.from('clients').update({
      folder_url: folderPath
    }).eq('id', client.id);

    const market = lead?.market || 'GLOBAL';
    const hinglish = isHinglishMarket(market);

    await sendWhatsApp({
      phone,
      templateName: `onboard_${program}`,
      body: hinglish
        ? `Welcome to the family, ${customer_name}! 🎉\n\nTumhara ${getProgramName(program)} officially start ho gaya hai.\n\nPehla check-in Day 7 pe aayega — tab tak apna best do! 💪`
        : `Welcome to the family, ${customer_name}! 🎉\n\nYour ${getProgramName(program)} has officially started.\n\nYour first check-in will be on Day 7 — give it your best until then! 💪`,
      params: {
        name: customer_name,
        templateParams: [customer_name, getProgramName(program)]
      }
    });

    if (program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://fitnessbymaddy.com';
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (e) {
        console.error('Week 1 program generation failed:', e.message);
      }
    }

    return res.status(200).json({ success: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function handlePaymentFailure(phone, name) {
  const { escalateToMaddy } = require('./lib/escalation');
  if (phone) {
    await escalateToMaddy({
      reason: 'Payment failure for potential client',
      phone: normalizePhone(phone),
      clientName: name,
      messageText: 'Payment failed at checkout'
    });
  }
}

function normalizePhone(raw) {
  if (!raw) return null;
  let phone = raw.toString().replace(/[\s\-\(\)]/g, '');
  if (!phone.startsWith('+')) phone = '+' + phone;
  return phone;
}

function detectProgram(productName, amount) {
  const lower = (productName || '').toLowerCase();
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40+') || lower.includes('40 plus')) return '40plus';
  if (lower.includes('12') || lower.includes('flagship') || lower.includes('custom')) return '12wk';
  if (lower.includes('trial') || lower.includes('zoom')) return 'zoom_trial';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('6') || lower.includes('shred') || lower.includes('burn')) return '6wk_gym';
  if (amount >= 150) return '12wk';
  if (amount <= 25) return 'zoom_trial';
  return '6wk_gym';
}

function getProgramName(program) {
  const names = {
    '6wk_gym': '6-Week Burn & Build',
    '6wk_home': '6-Week Home Program',
    '12wk': '12-Week Flagship Program',
    'pcos': 'PCOS Warrior Program',
    '40plus': '40+ Strong Program',
    'zoom_trial': 'Zoom Trial Session',
    'zoom_pack': 'Zoom Session Pack'
  };
  return names[program] || program;
}
