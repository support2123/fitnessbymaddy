const crypto = require('crypto');
const supabase = require('./_lib/supabase');
const { sendTemplate, maskPhone } = require('./_lib/whatsapp');

const PRODUCT_RULES = [
  { keywords: ['6 week', 'shred', 'burn'], program: '6wk_gym' },
  { keywords: ['pcos'], program: 'pcos' },
  { keywords: ['40+', '40 plus'], program: '40plus' },
  { keywords: ['12', 'custom', 'flagship'], program: '12wk' },
  { keywords: ['trial', 'zoom'], program: 'zoom_trial' },
];

function mapProduct(productName) {
  const lower = (productName || '').toLowerCase();
  for (const rule of PRODUCT_RULES) {
    for (const kw of rule.keywords) {
      if (lower.includes(kw)) return rule.program;
    }
  }
  return 'zoom_trial';
}

const PROGRAM_DURATIONS = {
  '6wk_gym': 42,
  '6wk_home': 42,
  pcos: 42,
  '40plus': 42,
  '12wk': 84,
  zoom_trial: 7,
  zoom_pack: 28,
};

function computeEndDate(program) {
  const days = PROGRAM_DURATIONS[program] || 42;
  const end = new Date();
  end.setDate(end.getDate() + days);
  return end.toISOString();
}

function verifySignature(rawBody, signature) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true; // No secret configured, skip verification
  if (!signature) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(expected, 'hex'),
    Buffer.from(signature, 'hex')
  );
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Verify webhook signature
    const signature = req.headers['x-exly-signature'];
    const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);

    if (!verifySignature(rawBody, signature)) {
      console.error('Exly webhook signature verification failed');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { event, data } = body || {};

    if (event !== 'payment.success') {
      return res.status(200).json({ ok: true, note: 'event ignored' });
    }

    const {
      customer_phone,
      customer_name,
      customer_email,
      amount,
      checkout_id,
      product_name,
    } = data || {};

    if (!customer_phone) {
      return res.status(400).json({ error: 'Missing customer_phone' });
    }

    const phone = customer_phone.startsWith('+')
      ? customer_phone
      : '+' + customer_phone.replace(/[^0-9]/g, '');
    const masked = maskPhone(phone);
    const program = mapProduct(product_name);

    // Find lead by phone
    const { data: lead } = await supabase
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .maybeSingle();

    const leadId = lead?.id || null;

    // Update lead status if found
    if (leadId) {
      await supabase
        .from('leads')
        .update({
          status: 'converted',
          program_interest: program,
          last_msg_at: new Date().toISOString(),
        })
        .eq('id', leadId);
    }

    // Insert client record
    const programEndsAt = computeEndDate(program);

    const { data: client, error: clientErr } = await supabase
      .from('clients')
      .insert({
        lead_id: leadId,
        phone,
        name: customer_name || null,
        email: customer_email || null,
        program,
        paid_amount: amount || 0,
        checkout_id: checkout_id || null,
        program_ends_at: programEndsAt,
        status: 'active',
      })
      .select('id')
      .single();

    if (clientErr) {
      console.error(`Failed to create client for ${masked}:`, clientErr.message);
      return res.status(500).json({ error: 'Failed to create client record' });
    }

    // Send onboarding WhatsApp template
    const templateName = `onboard_${program}`;
    const clientName = customer_name || 'there';
    await sendTemplate(phone, templateName, [clientName]);

    console.log(
      `Payment received: ${masked} -> program=${program}, amount=${amount}, client_id=${client.id}`
    );

    return res.status(200).json({ ok: true, client_id: client.id, program });
  } catch (err) {
    console.error('exly-webhook error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
