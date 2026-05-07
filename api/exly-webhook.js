const { supabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');
const crypto = require('crypto');

const PROGRAM_DURATIONS = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 28,
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

    const {
      checkout_id,
      customer_phone,
      customer_name,
      customer_email,
      product_name,
      amount,
    } = req.body;

    const phone = normalizePhone(customer_phone || '');
    if (!phone) {
      return res.status(400).json({ error: 'No phone number' });
    }

    const program = mapProductToProgram(product_name || '');
    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const programEnds = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000);

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .limit(1)
      .single();

    let leadId = lead?.id;

    if (lead) {
      await supabase
        .from('leads')
        .update({ status: 'converted', name: customer_name || lead.name })
        .eq('id', lead.id);
    } else {
      const { data: newLead } = await supabase
        .from('leads')
        .insert({
          phone,
          name: customer_name,
          source: 'exly',
          status: 'converted',
          market: detectMarket(phone),
        })
        .select()
        .single();
      leadId = newLead.id;
    }

    const { data: client } = await supabase
      .from('clients')
      .insert({
        lead_id: leadId,
        phone,
        name: customer_name,
        email: customer_email,
        program,
        program_started_at: new Date().toISOString(),
        program_ends_at: programEnds.toISOString(),
        paid_amount: amount,
        checkout_id,
        folder_url: `/clients/${leadId}/`,
        status: 'active',
      })
      .select()
      .single();

    const market = lead?.market || detectMarket(phone);
    const templateName = isHinglish(market) ? `onboard_${program}` : `onboard_${program}_en`;
    await sendTemplate(phone, templateName, [customer_name || 'there']);

    if (program === '12wk') {
      await triggerProgramGeneration(client.id, 1);
    }

    return res.status(200).json({ success: true, clientId: client.id });
  } catch (err) {
    console.error('[exly-webhook]', err.message);
    return res.status(500).json({ error: 'Failed to process purchase' });
  }
};

function mapProductToProgram(productName) {
  const lower = productName.toLowerCase();
  if (lower.includes('12') || lower.includes('flagship') || lower.includes('custom')) return '12wk';
  if (lower.includes('pcos') || lower.includes('warrior')) return 'pcos';
  if (lower.includes('40') || lower.includes('strong')) return '40plus';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('zoom') && lower.includes('pack')) return 'zoom_pack';
  if (lower.includes('zoom') || lower.includes('trial')) return 'zoom_trial';
  return '6wk_gym';
}

async function triggerProgramGeneration(clientId, weekNo) {
  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'https://fitnessbymaddy.com';

  await fetch(`${baseUrl}/api/generate-program`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`,
    },
    body: JSON.stringify({ client_id: clientId, week_no: weekNo }),
  });
}

function normalizePhone(phone) {
  let cleaned = phone.replace(/[^0-9+]/g, '');
  if (!cleaned.startsWith('+') && cleaned.length >= 10) {
    cleaned = '+' + cleaned;
  }
  return cleaned;
}
