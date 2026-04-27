const crypto = require('crypto');
const { supabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');
const { formatProgramName } = require('../lib/pdf-generator');

const PROGRAM_DURATION = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 30,
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
        return res.status(403).json({ error: 'Invalid signature' });
      }
    }

    const {
      phone,
      email,
      name,
      checkout_id,
      amount,
      product_name,
    } = req.body;

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    const normalizedPhone = normalizePhone(phone);
    const program = mapProductToProgram(product_name, checkout_id);
    const durationDays = PROGRAM_DURATION[program] || 42;
    const programEnds = new Date(Date.now() + durationDays * 86400000).toISOString();

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', normalizedPhone)
      .single();

    if (lead) {
      await supabase
        .from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const { data: client } = await supabase
      .from('clients')
      .insert({
        lead_id: lead?.id || null,
        phone: normalizedPhone,
        name: name || lead?.name || null,
        email: email || null,
        program,
        program_ends_at: programEnds,
        paid_amount: amount || null,
        checkout_id: checkout_id || null,
        folder_url: null,
        status: 'active',
      })
      .select()
      .single();

    const folderPath = `clients/${client.id}/`;
    await supabase.storage
      .from('programs')
      .upload(`${folderPath}.keep`, Buffer.from(''), { upsert: true });

    await supabase
      .from('clients')
      .update({ folder_url: folderPath })
      .eq('id', client.id);

    const market = lead?.market || detectMarket(normalizedPhone);
    const hinglish = isHinglish(market);
    const templateName = hinglish ? `onboard_${program}_hi` : `onboard_${program}_en`;

    await sendTemplate(normalizedPhone, templateName, [
      client.name || 'there',
      formatProgramName(program),
    ], true);

    if (program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://fitnessbymaddy.com';
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`,
          },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch (genErr) {
        console.error('[EXLY] Program generation trigger failed:', genErr.message);
      }
    }

    return res.json({ ok: true, clientId: client.id, program });
  } catch (err) {
    console.error('[EXLY-WEBHOOK ERROR]', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function mapProductToProgram(productName, checkoutId) {
  const lower = ((productName || '') + ' ' + (checkoutId || '')).toLowerCase();
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40') || lower.includes('strong')) return '40plus';
  if (lower.includes('12') || lower.includes('flagship') || lower.includes('custom')) return '12wk';
  if (lower.includes('zoom') && lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('zoom') && lower.includes('pack')) return 'zoom_pack';
  if (lower.includes('home')) return '6wk_home';
  return '6wk_gym';
}

function normalizePhone(raw) {
  if (!raw) return null;
  let phone = raw.replace(/[^+\d]/g, '');
  if (!phone.startsWith('+')) phone = '+' + phone;
  return phone;
}
