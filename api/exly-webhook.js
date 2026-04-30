const { supabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { isHinglish } = require('../lib/market');
const crypto = require('crypto');

const PROGRAM_DURATIONS = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  pcos: 42,
  '40plus': 42,
  zoom_trial: 7,
  zoom_pack: 28,
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    if (process.env.EXLY_WEBHOOK_SECRET) {
      const signature = req.headers['x-exly-signature'];
      const expected = crypto
        .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
        .update(JSON.stringify(req.body))
        .digest('hex');

      if (signature !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const { phone, email, name, product_name, amount, checkout_id } = parseExlyPayload(req.body);

    if (!phone) return res.status(400).json({ error: 'No phone in payload' });

    const normalizedPhone = phone.replace(/\D/g, '').replace(/^0+/, '');
    const program = detectProgram(product_name);

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', normalizedPhone)
      .limit(1)
      .single();

    if (lead) {
      await supabase
        .from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const now = new Date();
    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const endsAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

    const { data: client, error } = await supabase
      .from('clients')
      .insert({
        lead_id: lead?.id || null,
        phone: normalizedPhone,
        name: name || lead?.name || null,
        email: email || null,
        program,
        program_started_at: now.toISOString(),
        program_ends_at: endsAt.toISOString(),
        paid_amount: amount ? Math.round(amount * 100) : null,
        checkout_id: checkout_id || null,
        folder_url: `clients/${normalizedPhone}/`,
        status: 'active',
      })
      .select()
      .single();

    if (error) throw error;

    const folderPath = `clients/${client.id}/.keep`;
    await supabase.storage
      .from('clients')
      .upload(folderPath, '', { upsert: true });

    const market = lead?.market || 'GLOBAL';
    const templateName = isHinglish(market)
      ? `onboard_${program}`
      : `onboard_${program}_en`;

    await sendTemplate(normalizedPhone, templateName, [
      name || 'there',
      `https://fitnessbymaddy.com/checkin?c=${client.id}&w=1`,
    ]);

    if (program === '12wk') {
      const baseUrl = `https://${req.headers.host || 'fitnessbymaddy.com'}`;
      fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: client.id, week_no: 1 }),
      }).catch(() => {});
    }

    return res.status(200).json({ ok: true, client_id: client.id });
  } catch (err) {
    console.error('[exly-webhook]', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function parseExlyPayload(body) {
  return {
    phone: body?.phone || body?.mobile || body?.customer_phone,
    email: body?.email || body?.customer_email,
    name: body?.name || body?.customer_name,
    product_name: body?.product_name || body?.item_name || '',
    amount: body?.amount || body?.total_amount || 0,
    checkout_id: body?.checkout_id || body?.order_id || body?.id,
  };
}

function detectProgram(productName) {
  if (!productName) return '6wk_gym';
  const lower = productName.toLowerCase();
  if (lower.includes('12') || lower.includes('flagship') || lower.includes('custom')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40') || lower.includes('strong')) return '40plus';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('zoom') && lower.includes('pack')) return 'zoom_pack';
  return '6wk_gym';
}
