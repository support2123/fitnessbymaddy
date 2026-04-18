const crypto = require('crypto');
const { getClient } = require('../lib/supabase');
const { sendTemplate, notifyMaddy } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/market');

function mapProductToProgram(name) {
  var lower = (name || '').toLowerCase();
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('shred') || lower.includes('burn') || lower.includes('6 week') || lower.includes('6wk')) return '6wk_gym';
  if (lower.includes('pcos') || lower.includes('hormonal')) return 'pcos';
  if (lower.includes('40+') || lower.includes('40 plus') || lower.includes('strong')) return '40plus';
  if (lower.includes('12') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('trial') || lower.includes('zoom trial')) return 'zoom_trial';
  if (lower.includes('zoom') || lower.includes('pack')) return 'zoom_pack';
  return '6wk_gym';
}

function getProgramDuration(program) {
  if (program === '12wk') return 84;
  if (program === '6wk_gym' || program === '6wk_home') return 42;
  if (program === 'pcos') return 42;
  if (program === '40plus') return 42;
  return 30;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // Verify webhook signature
    if (process.env.EXLY_WEBHOOK_SECRET) {
      var sig = req.headers['x-exly-signature'] || '';
      var expected = crypto
        .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (sig !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    var body = req.body;
    var customerPhone = body.customer_phone;
    if (!customerPhone) return res.status(400).json({ error: 'Missing customer_phone' });

    var phone = customerPhone.startsWith('+') ? customerPhone : '+' + customerPhone;
    var db = getClient();

    var leadResult = await db.from('leads').select('*').eq('phone', phone).single();
    var lead = leadResult.data;

    var program = mapProductToProgram(body.product_name || (lead && lead.program_interest) || '');
    var durationDays = getProgramDuration(program);
    var now = new Date();
    var endDate = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

    // Create client
    var clientResult = await db.from('clients').insert({
      lead_id: lead ? lead.id : null,
      phone: phone,
      name: body.customer_name || (lead && lead.name) || '',
      email: body.customer_email || '',
      program: program,
      program_started_at: now.toISOString(),
      program_ends_at: endDate.toISOString(),
      paid_amount: body.amount ? parseFloat(body.amount) : 0,
      checkout_id: body.checkout_id || null,
      status: 'active'
    }).select().single();

    if (clientResult.error) throw clientResult.error;
    var client = clientResult.data;

    // Update lead status
    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    // Create storage folder
    await db.storage.from('client-files').upload(
      'clients/' + client.id + '/.keep',
      Buffer.from(''),
      { contentType: 'text/plain' }
    );

    // Send onboarding WhatsApp
    await sendTemplate(phone, 'onboard_' + program,
      [body.customer_name || (lead && lead.name) || 'there'], true);

    // For 12-week program: generate Week-1 immediately
    if (program === '12wk') {
      var baseUrl = process.env.VERCEL_URL
        ? 'https://' + process.env.VERCEL_URL
        : 'https://fitnessbymaddy.com';
      fetch(baseUrl + '/api/generate-program', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: client.id, week_no: 1 })
      }).catch(function () {});
    }

    return res.status(200).json({ ok: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    await notifyMaddy('Payment Webhook Error', err.message).catch(function () {});
    return res.status(500).json({ error: 'Processing failed' });
  }
};
