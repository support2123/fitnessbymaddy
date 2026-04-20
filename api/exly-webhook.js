const { getSupabase } = require('../lib/supabase');
const { sendTemplate, notifyMaddy } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');
const { getProgramName } = require('../lib/qualify');
const crypto = require('crypto');

const PROGRAM_DURATIONS = {
  '6wk_gym': 42,
  '6wk_home': 42,
  'pcos': 42,
  '40plus': 42,
  '12wk': 84,
  'zoom_trial': 7,
  'zoom_pack': 30
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    if (process.env.EXLY_WEBHOOK_SECRET) {
      const signature = req.headers['x-exly-signature'] || '';
      const expected = crypto
        .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (signature !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const {
      checkout_id, phone, name, email,
      product_name, amount, status: paymentStatus
    } = req.body;

    if (paymentStatus === 'failed') {
      await notifyMaddy('Payment failed', `Phone: ${phone}\nProduct: ${product_name}\nAmount: ${amount}`);
      return res.status(200).json({ action: 'payment_failed_notified' });
    }

    if (paymentStatus !== 'success' && paymentStatus !== 'completed') {
      return res.status(200).json({ action: 'ignored', status: paymentStatus });
    }

    const db = getSupabase();
    const normalizedPhone = normalizePhone(phone);
    const program = detectProgram(product_name);

    let lead;
    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', normalizedPhone)
      .single();

    if (existingLead) {
      lead = existingLead;
      await db.from('leads').update({
        status: 'converted',
        name: name || existingLead.name,
        last_msg_at: new Date().toISOString()
      }).eq('id', existingLead.id);
    } else {
      const { data: newLead } = await db.from('leads').insert({
        phone: normalizedPhone,
        name,
        source: 'exly_purchase',
        status: 'converted',
        market: detectMarket(normalizedPhone),
        program_interest: program
      }).select().single();
      lead = newLead;
    }

    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + durationDays * 24 * 60 * 60 * 1000);

    const folderPath = `clients/${lead.id}`;

    const { data: client } = await db.from('clients').insert({
      lead_id: lead.id,
      phone: normalizedPhone,
      name: name || lead.name,
      email,
      program,
      program_started_at: startDate.toISOString(),
      program_ends_at: endDate.toISOString(),
      paid_amount: amount ? parseInt(amount) : null,
      checkout_id,
      folder_url: folderPath,
      status: 'active'
    }).select().single();

    const hinglish = isHinglish(lead.market);
    const programName = getProgramName(program);

    if (hinglish) {
      await sendTemplate(normalizedPhone, 'onboard_program', [
        name || lead.name || 'there',
        `Welcome! ${programName} shuru ho gaya hai. Pehla check-in Day 7 pe aayega. Let's go!`
      ]);
    } else {
      await sendTemplate(normalizedPhone, 'onboard_program', [
        name || lead.name || 'there',
        `Welcome! Your ${programName} starts now. First check-in will be on Day 7. Let's do this!`
      ]);
    }

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
        console.error('Week 1 program gen failed:', e.message);
      }
    }

    return res.status(200).json({ ok: true, client_id: client.id });

  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function detectProgram(productName) {
  if (!productName) return '6wk_gym';
  const lower = productName.toLowerCase();
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40+') || lower.includes('40 plus')) return '40plus';
  if (lower.includes('12') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('zoom') && lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('zoom') || lower.includes('1-on-1') || lower.includes('vip')) return 'zoom_pack';
  if (lower.includes('home')) return '6wk_home';
  return '6wk_gym';
}

function normalizePhone(phone) {
  let cleaned = (phone || '').replace(/[^0-9+]/g, '');
  if (!cleaned.startsWith('+') && cleaned.length >= 10) cleaned = '+' + cleaned;
  return cleaned;
}
