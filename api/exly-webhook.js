const crypto = require('crypto');
const { supabase } = require('../lib/supabase');
const { sendTemplate, notifyMaddy } = require('../lib/whatsapp');
const { isHinglish, maskPhone } = require('../lib/market');

const PROGRAM_DURATIONS = {
  '6wk_gym': 42, '6wk_home': 42,
  'pcos': 42, '40plus': 42,
  '12wk': 84, 'zoom_trial': 7, 'zoom_pack': 30
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    if (process.env.EXLY_WEBHOOK_SECRET) {
      const sig = req.headers['x-exly-signature'] || '';
      const expected = crypto
        .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (sig !== expected) {
        return res.status(401).json({ error: 'invalid signature' });
      }
    }

    const { phone, name, email, product, amount, checkout_id } = req.body;

    if (!phone || !product) {
      return res.status(400).json({ error: 'missing phone or product' });
    }

    const normalizedPhone = normalizePhone(phone);
    const program = mapProduct(product);

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', normalizedPhone)
      .maybeSingle();

    if (lead) {
      await supabase.from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const programEnds = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000);

    const { data: client, error } = await supabase
      .from('clients')
      .insert({
        lead_id: lead?.id || null,
        phone: normalizedPhone,
        name: name || lead?.name,
        email,
        program,
        program_started_at: new Date().toISOString(),
        program_ends_at: programEnds.toISOString(),
        paid_amount: parseInt(amount) || 0,
        checkout_id,
        status: 'active'
      })
      .select()
      .single();

    if (error) throw error;

    const folderPath = `clients/${client.id}`;
    await supabase.storage
      .from('programs')
      .upload(`${folderPath}/.keep`, new Uint8Array(0), {
        contentType: 'text/plain',
        upsert: true
      });

    await supabase.from('clients')
      .update({ folder_url: folderPath })
      .eq('id', client.id);

    const market = lead?.market || 'GLOBAL';
    const hinglish = isHinglish(market);
    const welcomeMsg = hinglish
      ? `Welcome to the family! Tumhara ${program} program start ho gaya hai. Pehla check-in Day 7 pe aayega. Let's go!`
      : `Welcome aboard! Your ${program} program is officially active. Your first check-in will be on Day 7. Let's crush it!`;

    await sendTemplate(normalizedPhone, `onboard_${program}`, {
      name: client.name || 'Champion',
      templateParams: [welcomeMsg]
    }, true);

    if (program === '12wk') {
      const baseUrl = process.env.VERCEL_URL || 'www.fitnessbymaddy.com';
      fetch(`https://${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`
        },
        body: JSON.stringify({ client_id: client.id, week_no: 1 })
      }).catch(err => console.error('Week 1 program gen failed:', err.message));
    }

    return res.json({ success: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    if (err.message?.includes('payment') || err.message?.includes('amount')) {
      await notifyMaddy('Payment issue', `Error processing payment webhook: ${err.message}`);
    }
    return res.status(500).json({ error: 'processing failed' });
  }
};

function normalizePhone(raw) {
  let phone = (raw || '').replace(/[^0-9+]/g, '');
  if (!phone.startsWith('+')) phone = '+' + phone;
  return phone;
}

function mapProduct(product) {
  const lower = (product || '').toLowerCase();
  if (lower.includes('6') && lower.includes('gym')) return '6wk_gym';
  if (lower.includes('6') && lower.includes('home')) return '6wk_home';
  if (lower.includes('6') || lower.includes('shred') || lower.includes('burn')) return '6wk_gym';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40')) return '40plus';
  if (lower.includes('12') || lower.includes('flagship') || lower.includes('custom')) return '12wk';
  if (lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('zoom') && lower.includes('pack')) return 'zoom_pack';
  return '6wk_gym';
}
