const crypto = require('crypto');
const { supabase } = require('./lib/supabase');
const { sendTemplate } = require('./lib/whatsapp');
const { programWeeks } = require('./lib/helpers');
const { notifyMaddy } = require('./lib/escalate');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    if (process.env.EXLY_WEBHOOK_SECRET) {
      const sig = req.headers['x-exly-signature'];
      const expected = crypto
        .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (sig !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const {
      customerPhone,
      customerName,
      customerEmail,
      productName,
      amount,
      checkoutId,
      orderId,
    } = req.body;

    if (!customerPhone) {
      return res.status(400).json({ error: 'Missing customerPhone' });
    }

    const program = mapExlyProduct(productName);
    const weeks = programWeeks(program);
    const endsAt = new Date();
    endsAt.setDate(endsAt.getDate() + weeks * 7);

    const { data: lead } = await supabase
      .from('leads')
      .select('id')
      .eq('phone', customerPhone)
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
        phone: customerPhone,
        name: customerName,
        email: customerEmail,
        program,
        program_ends_at: endsAt.toISOString(),
        paid_amount: Math.round(amount * 100),
        checkout_id: checkoutId || orderId,
        folder_url: `/clients/${checkoutId || orderId}/`,
        status: 'active',
      })
      .select()
      .single();

    await sendTemplate(customerPhone, `onboard_${program}`, {
      name: customerName || 'there',
      templateParams: [
        customerName || 'there',
        `${weeks} week`,
        'https://fitnessbymaddy.com/checkin.html?c=' + client.id + '&w=1',
      ],
    });

    if (program === '12wk') {
      await triggerProgramGeneration(client.id, 1);
    }

    return res.status(200).json({ ok: true, clientId: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    await notifyMaddy('Payment webhook error', {
      phone: req.body?.customerPhone,
      details: err.message,
    });
    return res.status(500).json({ error: 'Internal error' });
  }
};

function mapExlyProduct(productName) {
  if (!productName) return '6wk_gym';
  const name = productName.toLowerCase();
  if (name.includes('12') || name.includes('flagship') || name.includes('custom')) return '12wk';
  if (name.includes('pcos')) return 'pcos';
  if (name.includes('40')) return '40plus';
  if (name.includes('zoom') && name.includes('trial')) return 'zoom_trial';
  if (name.includes('zoom')) return 'zoom_pack';
  if (name.includes('home')) return '6wk_home';
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
      Authorization: `Bearer ${process.env.INTERNAL_API_KEY}`,
    },
    body: JSON.stringify({ clientId, weekNo }),
  });
}
