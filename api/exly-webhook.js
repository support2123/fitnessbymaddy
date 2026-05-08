const crypto = require('crypto');
const { supabase } = require('./lib/supabase');
const { sendTemplate } = require('./lib/whatsapp');

function verifySignature(body, signature) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(body))
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature || ''), Buffer.from(expected));
}

const PROGRAM_DURATIONS = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 30,
};

const TEMPLATE_MAP = {
  '6wk_gym': 'onboard_6wk_gym',
  '6wk_home': 'onboard_6wk_home',
  '12wk': 'onboard_12wk',
  'pcos': 'onboard_pcos',
  '40plus': 'onboard_40plus',
  'zoom_trial': 'onboard_zoom_trial',
  'zoom_pack': 'onboard_zoom_pack',
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const sig = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'];
    if (process.env.EXLY_WEBHOOK_SECRET && !verifySignature(req.body, sig)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const {
      customer_phone,
      customer_name,
      customer_email,
      product_name,
      amount,
      checkout_id,
      status,
    } = req.body;

    if (status !== 'completed' && status !== 'success') {
      return res.json({ action: 'ignored', reason: 'not completed' });
    }

    const phone = customer_phone;
    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    const { data: lead } = await supabase
      .from('leads')
      .select('id, program_interest')
      .eq('phone', phone)
      .maybeSingle();

    const program = lead?.program_interest || mapProductToProgram(product_name);

    if (lead) {
      await supabase
        .from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const startDate = new Date();
    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const endDate = new Date(startDate.getTime() + durationDays * 86400000);

    const { data: client, error: clientErr } = await supabase
      .from('clients')
      .insert({
        lead_id: lead?.id || null,
        phone,
        name: customer_name,
        email: customer_email,
        program,
        program_started_at: startDate.toISOString(),
        program_ends_at: endDate.toISOString(),
        paid_amount: amount ? Math.round(amount * 100) : null,
        checkout_id,
        status: 'active',
      })
      .select('id')
      .single();

    if (clientErr) {
      console.error('Client creation error:', clientErr.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    const folderPath = `clients/${client.id}`;
    await supabase.storage
      .from('coaching')
      .upload(`${folderPath}/.keep`, new Uint8Array(0), { upsert: true });

    await supabase
      .from('clients')
      .update({ folder_url: folderPath })
      .eq('id', client.id);

    const templateName = TEMPLATE_MAP[program] || 'onboard_generic';
    await sendTemplate(phone, templateName, [customer_name || 'there']);

    if (program === '12wk') {
      try {
        const baseUrl = `https://${req.headers.host}`;
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch (genErr) {
        console.error('Week 1 program generation failed:', genErr.message);
      }
    }

    return res.json({ action: 'converted', client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function mapProductToProgram(productName) {
  const lower = (productName || '').toLowerCase();
  if (lower.includes('12') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40')) return '40plus';
  if (lower.includes('zoom') && lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('zoom')) return 'zoom_pack';
  if (lower.includes('home')) return '6wk_home';
  return '6wk_gym';
}
