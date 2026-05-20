const crypto = require('crypto');
const { supabase } = require('./_lib/supabase');
const { sendTemplate } = require('./_lib/whatsapp');
const { detectMarket } = require('./_lib/market');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const signature = req.headers['x-exly-signature'] || '';
    const secret = process.env.EXLY_WEBHOOK_SECRET;

    if (secret && signature) {
      const expected = crypto
        .createHmac('sha256', secret)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (signature !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const {
      customer_phone, customer_name, customer_email,
      product_name, amount, checkout_id, status,
    } = req.body;

    if (status !== 'completed' && status !== 'paid') {
      if (status === 'failed') {
        const { data: lead } = await supabase
          .from('leads')
          .select('phone')
          .eq('phone', normalizePhone(customer_phone))
          .single();

        if (lead) {
          const { notifyMaddy } = require('./_lib/whatsapp');
          await notifyMaddy(
            'Payment failed',
            `${customer_name} (${customer_phone}) — ${product_name}`
          );
        }
      }
      return res.status(200).json({ action: 'ignored', status });
    }

    const phone = normalizePhone(customer_phone);
    const program = mapProductToProgram(product_name);
    const market = detectMarket(phone);

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

    const programDays = getProgramDays(program);
    const endsAt = new Date(Date.now() + programDays * 24 * 60 * 60 * 1000).toISOString();

    const { data: client, error } = await supabase
      .from('clients')
      .insert({
        lead_id: lead ? lead.id : null,
        phone,
        name: customer_name,
        email: customer_email,
        program,
        paid_amount: Math.round(parseFloat(amount) * 100),
        checkout_id,
        program_ends_at: endsAt,
        folder_url: null,
      })
      .select()
      .single();

    if (error) throw error;

    const templateName = `onboard_${program}`;
    await sendTemplate(phone, templateName, [customer_name || 'Champion']);

    if (program === '12wk') {
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'https://fitnessbymaddy.com';
      try {
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`,
          },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch (genErr) {
        console.error('Week 1 generation failed:', genErr.message);
      }
    }

    return res.status(200).json({ ok: true, clientId: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function mapProductToProgram(productName) {
  if (!productName) return '6wk_gym';
  const lower = productName.toLowerCase();
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40+') || lower.includes('40 plus') || lower.includes('forty')) return '40plus';
  if (lower.includes('12') || lower.includes('twelve') || lower.includes('flagship')) return '12wk';
  if (lower.includes('zoom') || lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('home')) return '6wk_home';
  return '6wk_gym';
}

function getProgramDays(program) {
  const map = {
    '6wk_gym': 42, '6wk_home': 42, '12wk': 84,
    'pcos': 42, '40plus': 42, 'zoom_trial': 7, 'zoom_pack': 30,
  };
  return map[program] || 42;
}

function normalizePhone(raw) {
  if (!raw) return '';
  let cleaned = raw.replace(/[^0-9+]/g, '');
  if (!cleaned.startsWith('+')) cleaned = '+' + cleaned;
  return cleaned;
}
