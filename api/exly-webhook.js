const supabase = require('./_lib/supabase');
const { sendTemplate } = require('./_lib/whatsapp');
const { notifyMaddy } = require('./_lib/escalation');
const { detectMarket } = require('./_lib/market');
const crypto = require('crypto');

const PROGRAM_DURATION = {
  '6wk_gym': 42, '6wk_home': 42,
  '12wk': 84,
  'pcos': 42, '40plus': 42,
  'zoom_trial': 7, 'zoom_pack': 28
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    // Verify webhook signature if secret is configured
    if (process.env.EXLY_WEBHOOK_SECRET) {
      const sig = req.headers['x-exly-signature'] || '';
      const expected = crypto
        .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (sig !== expected) return res.status(401).json({ error: 'invalid signature' });
    }

    const {
      customer_name, customer_phone, customer_email,
      product_name, amount, checkout_id, status
    } = req.body;

    if (status !== 'completed' && status !== 'paid') {
      if (status === 'failed') {
        await notifyMaddy('Payment Failed', `Phone: ${customer_phone}\nProduct: ${product_name}`);
      }
      return res.json({ action: 'ignored', reason: `status: ${status}` });
    }

    const phone = normalizePhone(customer_phone);
    if (!phone) return res.status(400).json({ error: 'missing phone' });

    const program = detectProgram(product_name);

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (lead) {
      await supabase.from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const durationDays = PROGRAM_DURATION[program] || 42;
    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + durationDays * 24 * 60 * 60 * 1000);

    const { data: client } = await supabase.from('clients').insert({
      lead_id: lead ? lead.id : null,
      phone,
      name: customer_name,
      email: customer_email,
      program,
      program_started_at: startDate.toISOString(),
      program_ends_at: endDate.toISOString(),
      paid_amount: Math.round(parseFloat(amount) * 100),
      checkout_id,
      folder_url: `clients/${crypto.randomUUID()}`,
      status: 'active'
    }).select().single();

    // Create storage folder
    const folderMarker = `${client.folder_url}/.folder`;
    await supabase.storage.from('client-data')
      .upload(folderMarker, '', { contentType: 'text/plain', upsert: true });

    // Send onboarding WhatsApp template
    const market = lead ? lead.market : detectMarket(phone);
    const templateName = market === 'IN' ? `onboard_${program}` : `onboard_${program}_en`;
    await sendTemplate(phone, templateName, [customer_name || 'there']);

    // For 12wk, trigger immediate Week-1 program generation
    if (program === '12wk') {
      const generateUrl = `https://${req.headers.host}/api/generate-program`;
      fetch(generateUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: client.id, week_no: 1 })
      }).catch(() => {});
    }

    return res.json({ action: 'converted', client_id: client.id, program });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'internal' });
  }
};

function detectProgram(productName) {
  if (!productName) return '6wk_gym';
  const lower = productName.toLowerCase();
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40+') || lower.includes('40 plus')) return '40plus';
  if (lower.includes('12') || lower.includes('flagship') || lower.includes('custom')) return '12wk';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('zoom pack') || lower.includes('zoom 4')) return 'zoom_pack';
  return '6wk_gym';
}

function normalizePhone(phone) {
  if (!phone) return null;
  let cleaned = phone.replace(/[^0-9+]/g, '');
  if (!cleaned.startsWith('+')) cleaned = '+' + cleaned;
  return cleaned;
}
