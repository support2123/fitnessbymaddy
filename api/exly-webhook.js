const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, notifyMaddy } = require('../lib/whatsapp');
const { json, maskPhone, programLabel } = require('../lib/utils');
const crypto = require('crypto');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return json(res, { error: 'POST only' }, 405);

  const db = getSupabase();

  try {
    // Verify webhook signature if secret is configured
    const secret = process.env.EXLY_WEBHOOK_SECRET;
    if (secret) {
      const sig = req.headers['x-exly-signature'] || '';
      const expected = crypto
        .createHmac('sha256', secret)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (sig !== expected) {
        return json(res, { error: 'Invalid signature' }, 401);
      }
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

    if (status !== 'completed' && status !== 'paid') {
      // Payment failure — notify Maddy
      if (status === 'failed') {
        await notifyMaddy(`Payment failed for ${maskPhone(customer_phone)} — ${product_name}`);
      }
      return json(res, { action: 'ignored', status });
    }

    const phone = customer_phone.replace(/[^0-9]/g, '');

    // Map Exly product to internal program code
    const program = mapExlyProduct(product_name);

    // Find the lead
    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    const leadId = lead ? lead.id : null;

    // Update lead status to converted
    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    // Calculate program end date
    const startDate = new Date();
    const weekMap = { '6wk_gym': 6, '6wk_home': 6, '12wk': 12, 'pcos': 6, '40plus': 8, 'zoom_trial': 1, 'zoom_pack': 4 };
    const weeks = weekMap[program] || 6;
    const endDate = new Date(startDate.getTime() + weeks * 7 * 24 * 60 * 60 * 1000);

    // Create client record
    const { data: client, error: clientErr } = await db.from('clients').insert({
      lead_id: leadId,
      phone,
      name: customer_name,
      email: customer_email,
      program,
      program_started_at: startDate.toISOString(),
      program_ends_at: endDate.toISOString(),
      paid_amount: Math.round(amount * 100),
      checkout_id,
      status: 'active',
    }).select().single();

    if (clientErr) {
      console.error('Client insert error:', clientErr.message);
      return json(res, { error: 'Failed to create client' }, 500);
    }

    // Create storage folder
    const folderPath = `clients/${client.id}/`;
    await db.storage.from('client-files').upload(
      `${folderPath}.keep`,
      new Blob([''], { type: 'text/plain' })
    );
    await db.from('clients').update({ folder_url: folderPath }).eq('id', client.id);

    // Send welcome/onboarding WhatsApp
    await sendWhatsApp({
      phone,
      templateName: `onboard_${program}`,
      params: [customer_name || 'there', programLabel(program)],
    });

    // For 12-week programs, trigger immediate Week 1 generation
    if (program === '12wk') {
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'https://fitnessbymaddy.com';

      await fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: client.id, week_no: 1 }),
      });
    }

    return json(res, { action: 'converted', client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return json(res, { error: 'Internal error' }, 500);
  }
};

function mapExlyProduct(productName) {
  if (!productName) return '6wk_gym';
  const lower = productName.toLowerCase();
  if (lower.includes('12') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40') || lower.includes('strong')) return '40plus';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('zoom') && lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('zoom')) return 'zoom_pack';
  return '6wk_gym';
}
