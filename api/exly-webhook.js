const { supabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const crypto = require('crypto');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Verify webhook signature if secret is configured
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

  try {
    const { event, data } = req.body;

    if (event !== 'purchase.completed') {
      return res.status(200).json({ action: 'ignored', event });
    }

    const { customer_phone, customer_name, customer_email, product_name, amount, checkout_id } = data;

    if (!customer_phone) {
      return res.status(400).json({ error: 'Missing customer phone' });
    }

    const phone = normalizePhone(customer_phone);
    const program = mapProductToProgram(product_name);

    // Find matching lead
    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    // Update lead status
    if (lead) {
      await supabase
        .from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    // Calculate program end date
    const startDate = new Date();
    const weeks = program === '12wk' ? 12 : 6;
    const endDate = new Date(startDate.getTime() + weeks * 7 * 24 * 60 * 60 * 1000);

    // Create client
    const { data: client } = await supabase
      .from('clients')
      .insert({
        lead_id: lead?.id || null,
        phone,
        name: customer_name || lead?.name || null,
        email: customer_email || null,
        program,
        program_started_at: startDate.toISOString(),
        program_ends_at: endDate.toISOString(),
        paid_amount: amount || null,
        checkout_id: checkout_id || null,
        status: 'active'
      })
      .select()
      .single();

    // Create storage folder
    const folderPath = `clients/${client.id}/.keep`;
    await supabase.storage.from('clients').upload(folderPath, new Uint8Array(0), {
      contentType: 'application/octet-stream',
      upsert: true
    });

    await supabase
      .from('clients')
      .update({ folder_url: `clients/${client.id}/` })
      .eq('id', client.id);

    // Send onboarding template
    const templateName = `onboard_${program}`;
    await sendTemplate(phone, templateName, [customer_name || 'there']);

    // For 12-week program: trigger immediate Week 1 generation
    if (program === '12wk') {
      const generateUrl = `${process.env.VERCEL_URL || 'https://fitnessbymaddy.com'}/api/generate-program`;
      fetch(generateUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-key': process.env.INTERNAL_API_KEY
        },
        body: JSON.stringify({ client_id: client.id, week_no: 1 })
      }).catch(() => {});
    }

    return res.status(200).json({ success: true, client_id: client.id });

  } catch (err) {
    console.error('exly-webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function normalizePhone(phone) {
  let cleaned = phone.replace(/[\s\-()]/g, '');
  if (!cleaned.startsWith('+')) {
    if (cleaned.length === 10) cleaned = '+91' + cleaned;
    else cleaned = '+' + cleaned;
  }
  return cleaned;
}

function mapProductToProgram(productName) {
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
