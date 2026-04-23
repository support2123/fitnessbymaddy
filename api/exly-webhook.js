const crypto = require('crypto');
const { supabase } = require('./lib/supabase');
const { sendTemplate, sendText } = require('./lib/whatsapp');
const { detectMarket, isHinglish } = require('./lib/market');

const PROGRAM_MAP = {
  '6wk_gym': { name: '6-Week Burn & Build (Gym)', weeks: 6 },
  '6wk_home': { name: '6-Week Burn & Build (Home)', weeks: 6 },
  '12wk': { name: '12-Week Custom Training', weeks: 12 },
  'pcos': { name: 'PCOS Warrior', weeks: 6 },
  '40plus': { name: '40+ Strong', weeks: 8 },
  'zoom_trial': { name: 'Zoom Trial Session', weeks: 1 },
  'zoom_pack': { name: 'Zoom Pack', weeks: 4 }
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const webhookSecret = process.env.EXLY_WEBHOOK_SECRET;
  if (webhookSecret) {
    const signature = req.headers['x-exly-signature'] || '';
    const payload = JSON.stringify(req.body);
    const expected = crypto.createHmac('sha256', webhookSecret).update(payload).digest('hex');
    if (signature && signature !== expected) {
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }

  try {
    const {
      phone, name, email, amount, checkout_id,
      product_id, product_name, status: paymentStatus
    } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone required' });
    if (paymentStatus && paymentStatus !== 'success' && paymentStatus !== 'completed') {
      return res.status(200).json({ action: 'payment_not_successful', status: paymentStatus });
    }

    const normalizedPhone = normalizePhone(phone);
    const program = detectProgram(product_id, product_name);
    const programInfo = PROGRAM_MAP[program] || PROGRAM_MAP['6wk_gym'];
    const market = detectMarket(normalizedPhone);

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', normalizedPhone)
      .single();

    if (lead) {
      await supabase
        .from('leads')
        .update({ status: 'converted', program_interest: program })
        .eq('id', lead.id);
    }

    const startDate = new Date();
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + programInfo.weeks * 7);

    const { data: client, error: clientErr } = await supabase
      .from('clients')
      .insert({
        lead_id: lead?.id || null,
        phone: normalizedPhone,
        name: name || lead?.name,
        email,
        program,
        program_started_at: startDate.toISOString(),
        program_ends_at: endDate.toISOString(),
        paid_amount: amount ? Math.round(parseFloat(amount) * 100) : 0,
        checkout_id,
        status: 'active'
      })
      .select()
      .single();

    if (clientErr) {
      console.error('Client insert error:', clientErr.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    const folderPath = `clients/${client.id}`;
    await supabase
      .from('clients')
      .update({ folder_url: folderPath })
      .eq('id', client.id);

    const templateName = `onboard_${program}`;
    await sendTemplate(normalizedPhone, templateName, {
      name: name || 'there',
      templateParams: [name || 'there', programInfo.name, `${programInfo.weeks} weeks`]
    });

    if (isHinglish(market)) {
      await sendText(normalizedPhone,
        `Welcome to ${programInfo.name}! Aapka program shuru ho gaya hai.\n\n` +
        `Week 1 ka check-in Day 7 pe aayega. Tab tak apna best do!\n\n` +
        `Koi bhi question ho toh yahan message karo.`
      );
    } else {
      await sendText(normalizedPhone,
        `Welcome to ${programInfo.name}! Your program has officially started.\n\n` +
        `Your first check-in will arrive on Day 7. Give it your best until then!\n\n` +
        `Feel free to message here if you have any questions.`
      );
    }

    if (program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://fitnessbymaddy.com';
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`
          },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (genErr) {
        console.error('Week-1 program generation error:', genErr.message);
      }
    }

    return res.status(200).json({ ok: true, clientId: client.id, program });
  } catch (err) {
    console.error('exly-webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function detectProgram(productId, productName) {
  const id = (productId || '').toLowerCase();
  const name = (productName || '').toLowerCase();
  if (id.includes('pcos') || name.includes('pcos')) return 'pcos';
  if (id.includes('40') || name.includes('40+') || name.includes('40 plus')) return '40plus';
  if (id.includes('12wk') || id.includes('12_week') || name.includes('12 week') || name.includes('custom')) return '12wk';
  if (id.includes('home') || name.includes('home')) return '6wk_home';
  if (id.includes('zoom_pack') || name.includes('zoom pack')) return 'zoom_pack';
  if (id.includes('trial') || id.includes('zoom') || name.includes('trial') || name.includes('zoom')) return 'zoom_trial';
  return '6wk_gym';
}

function normalizePhone(phone) {
  let cleaned = (phone || '').replace(/[^0-9+]/g, '');
  if (!cleaned.startsWith('+') && cleaned.length > 10) {
    cleaned = '+' + cleaned;
  }
  return cleaned;
}
