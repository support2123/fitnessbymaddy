const { supabase } = require('./lib/supabase');
const { sendTemplate, detectMarket } = require('./lib/whatsapp');
const crypto = require('crypto');

const PROGRAM_DURATION = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 30
};

function verifyWebhookSignature(body, signature) {
  if (!process.env.EXLY_WEBHOOK_SECRET) return true;
  const expected = crypto
    .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
    .update(JSON.stringify(body))
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature || ''), Buffer.from(expected));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const signature = req.headers['x-exly-signature'];
  if (!verifyWebhookSignature(req.body, signature)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const { phone, email, name, checkout_id, amount, product_name } = req.body;

  if (!phone || !checkout_id) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    // Find the lead
    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    const program = lead?.program_interest || mapProductToProgram(product_name);
    const duration = PROGRAM_DURATION[program] || 42;
    const programEnds = new Date(Date.now() + duration * 24 * 60 * 60 * 1000).toISOString();

    // Create client record
    const { data: client, error: clientError } = await supabase
      .from('clients')
      .insert({
        lead_id: lead?.id || null,
        phone,
        name: name || lead?.name || null,
        email: email || null,
        program,
        program_started_at: new Date().toISOString(),
        program_ends_at: programEnds,
        paid_amount: amount ? parseInt(amount) : null,
        checkout_id,
        status: 'active'
      })
      .select()
      .single();

    if (clientError) {
      console.error('Client creation error:', clientError.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    // Update lead status
    if (lead) {
      await supabase
        .from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    // Create storage folder
    const folderPath = `clients/${client.id}/`;
    await supabase.storage.from('programs').upload(
      `${folderPath}.keep`,
      new Uint8Array(0),
      { contentType: 'text/plain' }
    );

    await supabase
      .from('clients')
      .update({ folder_url: folderPath })
      .eq('id', client.id);

    // Send onboarding WhatsApp
    const market = detectMarket(phone);
    const templateName = market === 'IN' ? `onboard_${program}_hindi` : `onboard_${program}`;
    await sendTemplate(phone, templateName, [name || 'there']);

    // For 12-week program: trigger immediate Week 1 generation
    if (program === '12wk') {
      fetch(`${process.env.VERCEL_URL || 'https://fitnessbymaddy.com'}/api/generate-program`, {
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
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function mapProductToProgram(productName) {
  const lower = (productName || '').toLowerCase();
  if (lower.includes('6 week') || lower.includes('shred') || lower.includes('burn')) return '6wk_gym';
  if (lower.includes('12 week') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40+') || lower.includes('40 plus')) return '40plus';
  if (lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('zoom') || lower.includes('pack')) return 'zoom_pack';
  return '6wk_gym';
}
