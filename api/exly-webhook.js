const { supabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { detectMarket, isHinglish } = require('./_lib/market');
const crypto = require('crypto');

const PROGRAM_DURATION = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 30
};

const ONBOARD_TEMPLATES = {
  '6wk_gym': 'onboard_6wk_gym',
  '6wk_home': 'onboard_6wk_home',
  '12wk': 'onboard_12wk',
  'pcos': 'onboard_pcos',
  '40plus': 'onboard_40plus',
  'zoom_trial': 'onboard_zoom_trial',
  'zoom_pack': 'onboard_zoom_pack'
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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

    const { phone, name, email, amount, checkout_id, product_name } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'Phone required' });
    }

    const normalizedPhone = phone.startsWith('+') ? phone : '+' + phone;
    const program = detectProgram(product_name);
    const market = detectMarket(normalizedPhone);
    const durationDays = PROGRAM_DURATION[program] || 42;
    const programEnds = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000);

    const { data: lead } = await supabase
      .from('leads')
      .select('id')
      .eq('phone', normalizedPhone)
      .single();

    if (lead) {
      await supabase.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const { data: client, error: clientErr } = await supabase
      .from('clients')
      .insert({
        lead_id: lead?.id || null,
        phone: normalizedPhone,
        name,
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

    if (clientErr) throw clientErr;

    const folderPath = `clients/${client.id}`;
    await supabase.storage.from('clients').upload(`${folderPath}/.keep`, new Uint8Array(0), {
      contentType: 'text/plain', upsert: true
    });

    await supabase.from('clients').update({ folder_url: folderPath }).eq('id', client.id);

    const templateName = ONBOARD_TEMPLATES[program] || 'onboard_default';
    const hinglish = isHinglish(market);
    const welcomeMsg = hinglish
      ? `Welcome to the family, ${name || 'champ'}! Tera ${program.replace(/_/g, ' ')} program start ho gaya hai. Week 1 ka plan jaldi aayega!`
      : `Welcome to the family, ${name || 'champ'}! Your ${program.replace(/_/g, ' ')} program has started. Week 1 plan coming soon!`;

    await sendWhatsApp({
      phone: normalizedPhone,
      templateName,
      params: [name || 'there'],
      body: welcomeMsg
    });

    if (program === '12wk') {
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'https://fitnessbymaddy.com';

      await fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: client.id, week_no: 1 })
      });
    }

    return res.status(200).json({ ok: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Conversion processing failed' });
  }
};

function detectProgram(productName) {
  const lower = (productName || '').toLowerCase();
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40+') || lower.includes('40 plus')) return '40plus';
  if (lower.includes('12') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('zoom') && lower.includes('pack')) return 'zoom_pack';
  return '6wk_gym';
}
