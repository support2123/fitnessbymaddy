const crypto = require('crypto');
const { getSupabase } = require('../lib/supabase');
const { sendWhatsAppMessage } = require('../lib/whatsapp');
const { isHinglish } = require('../lib/market');

const PROGRAM_MAP = {
  'zoom_trial': { duration: 7, price: 2000 },
  '6wk_gym': { duration: 42, price: 9700 },
  '6wk_home': { duration: 42, price: 9700 },
  'pcos': { duration: 42, price: 4500 },
  '40plus': { duration: 42, price: 5000 },
  '12wk': { duration: 84, price: 20000 },
  'zoom_pack': { duration: 30, price: 5000 }
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const secret = process.env.EXLY_WEBHOOK_SECRET;
    if (secret) {
      const signature = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'];
      if (signature) {
        const expected = crypto.createHmac('sha256', secret)
          .update(JSON.stringify(req.body))
          .digest('hex');
        if (signature !== expected) {
          return res.status(401).json({ error: 'Invalid signature' });
        }
      }
    }

    const {
      checkout_id, phone, email, name, amount,
      product_name, product_id, status
    } = req.body;

    if (status && status !== 'completed' && status !== 'success') {
      return res.status(200).json({ action: 'ignored', reason: 'not_completed' });
    }

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    const db = getSupabase();
    const normalizedPhone = normalizePhone(phone);

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', normalizedPhone)
      .single();

    const program = detectProgram(product_name, lead?.program_interest);
    const programInfo = PROGRAM_MAP[program] || PROGRAM_MAP['zoom_trial'];
    const now = new Date();
    const endsAt = new Date(now.getTime() + programInfo.duration * 24 * 60 * 60 * 1000);

    if (lead) {
      await db.from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const { data: existingClient } = await db
      .from('clients')
      .select('id')
      .eq('phone', normalizedPhone)
      .eq('status', 'active')
      .single();

    let clientId;

    if (existingClient) {
      await db.from('clients').update({
        program,
        paid_amount: amount || programInfo.price,
        checkout_id,
        program_started_at: now.toISOString(),
        program_ends_at: endsAt.toISOString()
      }).eq('id', existingClient.id);
      clientId = existingClient.id;
    } else {
      const { data: client, error } = await db.from('clients').insert({
        lead_id: lead?.id || null,
        phone: normalizedPhone,
        name: name || lead?.name,
        email,
        program,
        paid_amount: amount || programInfo.price,
        checkout_id,
        program_started_at: now.toISOString(),
        program_ends_at: endsAt.toISOString(),
        folder_url: `/clients/${lead?.id || 'new'}/`,
        status: 'active'
      }).select().single();

      if (error) throw error;
      clientId = client.id;
    }

    const market = lead?.market || 'GLOBAL';
    const hinglish = isHinglish(market);

    const welcomeMsg = hinglish
      ? `Welcome to the family! Tumhara ${formatProgram(program)} program start ho gaya hai.\n\nMaddy ki team tumhara plan tayyar kar rahi hai. Pehla check-in Day 7 pe hoga — form link milega WhatsApp pe.\n\nLet's crush this!`
      : `Welcome to the family! Your ${formatProgram(program)} program starts now.\n\nMaddy's team is preparing your plan. Your first check-in will be on Day 7 — you'll receive the form link right here on WhatsApp.\n\nLet's crush this!`;

    await sendWhatsAppMessage(normalizedPhone, welcomeMsg, `onboard_${program}`);

    if (program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://www.fitnessbymaddy.com';

        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: clientId, week_no: 1 })
        });
      } catch (genErr) {
        console.error('Week-1 program generation failed:', genErr.message);
      }
    }

    return res.status(200).json({ success: true, client_id: clientId, program });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function normalizePhone(phone) {
  if (!phone) return null;
  let cleaned = phone.replace(/[^0-9+]/g, '');
  if (!cleaned.startsWith('+')) cleaned = '+' + cleaned;
  return cleaned;
}

function detectProgram(productName, fallback) {
  if (!productName) return fallback || 'zoom_trial';
  const lower = productName.toLowerCase();
  if (lower.includes('12') && lower.includes('week')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40')) return '40plus';
  if (lower.includes('6') && lower.includes('home')) return '6wk_home';
  if (lower.includes('6') && lower.includes('week')) return '6wk_gym';
  if (lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('zoom') && lower.includes('pack')) return 'zoom_pack';
  return fallback || 'zoom_trial';
}

function formatProgram(code) {
  const map = {
    '6wk_gym': '6-Week Burn & Build (Gym)',
    '6wk_home': '6-Week Burn & Build (Home)',
    '12wk': '12-Week Flagship',
    'pcos': 'PCOS Warrior',
    '40plus': '40+ Strong',
    'zoom_trial': 'Zoom Trial',
    'zoom_pack': 'Zoom Pack'
  };
  return map[code] || code;
}
