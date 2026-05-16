const { supabase } = require('./lib/supabase');
const { sendTemplate, detectMarket } = require('./lib/whatsapp');
const crypto = require('crypto');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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

  try {
    const { customer_phone, customer_name, customer_email, product_name, amount, checkout_id } = req.body;

    if (!customer_phone) {
      return res.status(400).json({ error: 'Missing phone' });
    }

    const phone = normalizePhone(customer_phone);
    const program = mapProductToProgram(product_name);
    const programWeeks = getProgramWeeks(program);

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (lead) {
      await supabase
        .from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + programWeeks * 7 * 24 * 60 * 60 * 1000);

    const { data: client, error } = await supabase
      .from('clients')
      .insert({
        lead_id: lead?.id || null,
        phone,
        name: customer_name || lead?.name,
        email: customer_email,
        program,
        program_started_at: startDate.toISOString(),
        program_ends_at: endDate.toISOString(),
        paid_amount: amount,
        checkout_id,
        folder_url: `/clients/${crypto.randomUUID()}`,
        status: 'active'
      })
      .select()
      .single();

    if (error) {
      console.error('Client insert error:', error);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    const market = detectMarket(phone);
    const templateName = market === 'IN' ? `onboard_${program}_hi` : `onboard_${program}_en`;
    await sendTemplate(phone, templateName, [customer_name || 'there']);

    if (program === '12wk') {
      await triggerProgramGeneration(client.id, 1);
    }

    return res.status(200).json({ success: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function mapProductToProgram(productName) {
  if (!productName) return '6wk_gym';
  const lower = productName.toLowerCase();
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40+') || lower.includes('40 plus')) return '40plus';
  if (lower.includes('12') || lower.includes('flagship') || lower.includes('custom')) return '12wk';
  if (lower.includes('zoom') && lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('zoom') && lower.includes('pack')) return 'zoom_pack';
  if (lower.includes('home')) return '6wk_home';
  return '6wk_gym';
}

function getProgramWeeks(program) {
  const map = { '6wk_gym': 6, '6wk_home': 6, '12wk': 12, 'pcos': 8, '40plus': 8, 'zoom_trial': 1, 'zoom_pack': 4 };
  return map[program] || 6;
}

async function triggerProgramGeneration(clientId, weekNo) {
  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'https://fitnessbymaddy.com';

  try {
    await fetch(`${baseUrl}/api/generate-program`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, week_no: weekNo })
    });
  } catch (err) {
    console.error('Program generation trigger failed:', err.message);
  }
}

function normalizePhone(phone) {
  if (!phone) return null;
  let cleaned = phone.replace(/[^0-9+]/g, '');
  if (!cleaned.startsWith('+')) cleaned = '+' + cleaned;
  return cleaned;
}
