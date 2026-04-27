const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { getProgramDurationWeeks } = require('../lib/qualify');
const { escalateToMaddy } = require('../lib/escalation');
const crypto = require('crypto');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    if (process.env.EXLY_WEBHOOK_SECRET) {
      const sig = req.headers['x-exly-signature'] || '';
      const expected = crypto
        .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (sig && sig !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const {
      phone, name, email, checkout_id,
      product_name, amount, status: paymentStatus,
    } = req.body;

    if (paymentStatus !== 'paid' && paymentStatus !== 'completed') {
      if (paymentStatus === 'failed') {
        await escalateToMaddy('Payment failure', phone || 'unknown', `Checkout ${checkout_id}`);
      }
      return res.json({ action: 'ignored', status: paymentStatus });
    }

    const normalizedPhone = normalizePhone(phone);
    const program = mapProductToProgram(product_name);
    const db = getSupabase();

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', normalizedPhone)
      .single();

    const leadId = lead ? lead.id : null;

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const durationWeeks = getProgramDurationWeeks(program);
    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + durationWeeks * 7 * 24 * 60 * 60 * 1000);

    const { data: client } = await db.from('clients').insert({
      lead_id: leadId,
      phone: normalizedPhone,
      name: name || (lead && lead.name) || null,
      email: email || null,
      program,
      program_started_at: startDate.toISOString(),
      program_ends_at: endDate.toISOString(),
      paid_amount: parseFloat(amount) || 0,
      checkout_id: checkout_id || null,
      folder_url: null,
      status: 'active',
    }).select().single();

    const folderPath = `clients/${client.id}`;
    await db.storage.from('client-files').upload(
      `${folderPath}/.keep`,
      new Uint8Array([]),
      { contentType: 'text/plain', upsert: true }
    );
    await db.from('clients').update({ folder_url: folderPath }).eq('id', client.id);

    await sendWhatsApp(normalizedPhone, `onboard_${program}`, [
      name || 'there',
      durationWeeks.toString(),
    ]);

    if (program === '12wk') {
      const baseUrl = process.env.VERCEL_URL || 'fitnessbymaddy.com';
      await fetch(`https://${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`,
        },
        body: JSON.stringify({ client_id: client.id, week_no: 1 }),
      });
    }

    return res.json({ action: 'converted', client_id: client.id, program });
  } catch (err) {
    console.error('[exly-webhook]', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function mapProductToProgram(productName) {
  const lower = (productName || '').toLowerCase();
  if (lower.includes('12') || lower.includes('flagship') || lower.includes('custom')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40')) return '40plus';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('zoom') && lower.includes('pack')) return 'zoom_pack';
  if (lower.includes('zoom') || lower.includes('trial')) return 'zoom_trial';
  return '6wk_gym';
}

function normalizePhone(phone) {
  if (!phone) return '';
  let cleaned = phone.replace(/[\s\-\(\)]/g, '');
  if (!cleaned.startsWith('+')) cleaned = '+' + cleaned;
  return cleaned;
}
