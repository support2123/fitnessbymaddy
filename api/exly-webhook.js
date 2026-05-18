const crypto = require('crypto');
const { getSupabase } = require('../lib/supabase');
const { normalizePhone, programDurationWeeks, PROGRAM_NAMES, detectMarket, isHinglish } = require('../lib/helpers');
const { sendTemplate } = require('../lib/whatsapp');

function verifySignature(body, signature) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true; // Skip verification if no secret configured
  const expected = crypto.createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature || ''), Buffer.from(expected));
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const sig = req.headers['x-exly-signature'];
    if (process.env.EXLY_WEBHOOK_SECRET && !verifySignature(req.body, sig)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const { phone: rawPhone, email, name, product, amount, checkout_id, status: paymentStatus } = req.body;

    if (paymentStatus === 'failed') {
      const { escalatePaymentFailure } = require('../lib/escalation');
      await escalatePaymentFailure({ phone: rawPhone, name });
      return res.json({ action: 'payment_failed_escalated' });
    }

    if (paymentStatus !== 'success' && paymentStatus !== 'completed') {
      return res.json({ action: 'ignored', status: paymentStatus });
    }

    const phone = normalizePhone(rawPhone);
    const db = getSupabase();

    // Find or create lead
    let { data: lead } = await db
      .from('leads').select('*').eq('phone', phone).single();

    if (!lead) {
      const { data: newLead } = await db.from('leads').insert({
        phone, name, source: 'exly', status: 'converted',
        market: detectMarket(phone)
      }).select().single();
      lead = newLead;
    } else {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    // Map Exly product to internal program code
    const program = mapExlyProduct(product);
    const weeks = programDurationWeeks(program);
    const now = new Date();
    const endsAt = new Date(now.getTime() + weeks * 7 * 24 * 60 * 60 * 1000);

    // Create client record
    const { data: client, error: clientErr } = await db.from('clients').insert({
      lead_id: lead.id,
      phone, name: name || lead.name, email,
      program,
      program_started_at: now.toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: amount ? parseInt(amount) : null,
      checkout_id,
      status: 'active'
    }).select().single();

    if (clientErr) {
      console.error('Client creation error:', clientErr.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    // Create storage folder
    const folderPath = `clients/${client.id}/.keep`;
    await db.storage.from('programs').upload(folderPath, Buffer.from(''), { upsert: true });
    await db.from('clients').update({
      folder_url: `clients/${client.id}/`
    }).eq('id', client.id);

    // Send onboarding template
    const market = detectMarket(phone);
    const hinglish = isHinglish(market);
    const templateName = hinglish ? `onboard_${program}_hi` : `onboard_${program}_en`;
    await sendTemplate(phone, templateName, [
      name || 'there',
      PROGRAM_NAMES[program] || program,
      `${weeks} weeks`
    ]);

    // For 12-week program, trigger immediate Week-1 generation
    if (program === '12wk') {
      const baseUrl = `https://${req.headers.host}`;
      fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: client.id, week_no: 1 })
      }).catch(err => console.error('Week 1 gen failed:', err.message));
    }

    return res.json({ action: 'converted', client_id: client.id, program });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function mapExlyProduct(product) {
  if (!product) return '6wk_gym';
  const lower = (typeof product === 'string' ? product : '').toLowerCase();
  if (lower.includes('12') || lower.includes('flagship')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40')) return '40plus';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('trial') || lower.includes('zoom')) return 'zoom_trial';
  if (lower.includes('pack') || lower.includes('session')) return 'zoom_pack';
  return '6wk_gym';
}
