const crypto = require('crypto');
const { supabase } = require('./_lib/supabase');
const { sendTemplate, sendText } = require('./_lib/whatsapp');
const { maskPhone } = require('./_lib/market');

function verifySignature(body, signature) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(body))
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature || '', 'utf8'),
    Buffer.from(expected, 'utf8')
  );
}

const PROGRAM_DURATIONS = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 30
};

function mapExlyProduct(productName) {
  const lower = (productName || '').toLowerCase();
  if (lower.includes('12') || lower.includes('flagship') || lower.includes('custom')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40') || lower.includes('plus')) return '40plus';
  if (lower.includes('trial') || lower.includes('zoom')) return 'zoom_trial';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('6') || lower.includes('shred') || lower.includes('burn')) return '6wk_gym';
  return '6wk_gym';
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const signature = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'] || '';

  if (process.env.EXLY_WEBHOOK_SECRET && !verifySignature(req.body, signature)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  try {
    const {
      phone, email, name, product_name, amount,
      checkout_id, status: paymentStatus
    } = req.body;

    if (!phone) return res.status(400).json({ error: 'Phone required' });
    if (paymentStatus && paymentStatus !== 'success' && paymentStatus !== 'completed') {
      return res.status(200).json({ action: 'payment_not_complete' });
    }

    const program = mapExlyProduct(product_name);
    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const endsAt = new Date(Date.now() + durationDays * 86400000).toISOString();

    const { data: existingLead } = await supabase
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1);

    let leadId = existingLead?.[0]?.id;

    if (!leadId) {
      const { data: newLead } = await supabase
        .from('leads')
        .insert({ phone, name, source: 'exly', status: 'converted' })
        .select()
        .single();
      leadId = newLead.id;
    } else {
      await supabase
        .from('leads')
        .update({ status: 'converted' })
        .eq('id', leadId);
    }

    const { data: client, error } = await supabase
      .from('clients')
      .insert({
        lead_id: leadId,
        phone,
        name,
        email,
        program,
        program_started_at: new Date().toISOString(),
        program_ends_at: endsAt,
        paid_amount: amount ? parseInt(amount) : null,
        checkout_id,
        folder_url: null,
        status: 'active'
      })
      .select()
      .single();

    if (error) throw error;

    const welcomeMsg = program === '12wk'
      ? `Welcome to the 12-Week Flagship Program! Your personalised Week 1 plan is being created right now. You'll receive it within 24 hours. Let's go!`
      : `Welcome to FitnessByMaddy! Your ${product_name || program} program is now active. Check your email for program details. Any questions? Just reply here!`;

    await sendText(phone, welcomeMsg);

    if (program === '12wk') {
      try {
        const origin = `https://${req.headers.host}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (genErr) {
        console.error('Week 1 program generation trigger failed:', genErr.message);
      }
    }

    console.log(`New client: ${maskPhone(phone)}, program: ${program}`);
    return res.status(200).json({ success: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
