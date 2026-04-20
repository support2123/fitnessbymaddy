const crypto = require('crypto');
const { getClient } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { PROGRAMS } = require('../lib/constants');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    // Verify webhook signature if secret is configured
    if (process.env.EXLY_WEBHOOK_SECRET) {
      const signature = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'];
      if (signature) {
        const expected = crypto
          .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
          .update(JSON.stringify(req.body))
          .digest('hex');
        if (signature !== expected) {
          return res.status(401).json({ error: 'Invalid signature' });
        }
      }
    }

    const {
      checkout_id, phone, name, email,
      product_name, amount, currency,
    } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone required' });

    const db = getClient();
    const normalizedPhone = normalizePhone(phone);

    // Find matching lead
    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', normalizedPhone)
      .single();

    // Determine program from product name or lead interest
    const program = detectProgram(product_name, lead?.program_interest);
    const programInfo = PROGRAMS[program] || PROGRAMS['6wk_gym'];
    const now = new Date();
    const endsAt = new Date(now.getTime() + programInfo.duration_weeks * 7 * 24 * 60 * 60 * 1000);

    // Create client record
    const { data: client } = await db.from('clients').insert({
      lead_id: lead?.id || null,
      phone: normalizedPhone,
      name: name || lead?.name,
      email,
      program,
      program_started_at: now.toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: amount ? parseInt(amount) : programInfo.price * 100,
      checkout_id,
      status: 'active',
    }).select().single();

    // Update lead status
    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    // Create storage folder
    if (client) {
      const placeholder = Buffer.from('client folder initialized');
      await db.storage
        .from('clients')
        .upload(`${client.id}/.init`, placeholder, { upsert: true });

      await db.from('clients').update({
        folder_url: `clients/${client.id}/`,
      }).eq('id', client.id);
    }

    // Send onboarding WhatsApp
    await sendTemplate(normalizedPhone, `onboard_${program}`, {
      name: name || lead?.name || 'there',
      isClient: true,
      templateParams: [name || lead?.name || 'there', programInfo.name],
    });

    // For 12-week program: trigger Week 1 program generation
    if (program === '12wk' && client) {
      const baseUrl = `https://${req.headers.host}`;
      fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: client.id, week_no: 1 }),
      }).catch(err => console.error('Week 1 gen failed:', err.message));
    }

    return res.json({ ok: true, client_id: client?.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function normalizePhone(phone) {
  if (!phone) return null;
  let p = phone.replace(/[\s\-()]/g, '');
  if (!p.startsWith('+')) p = '+' + p;
  return p;
}

function detectProgram(productName, leadInterest) {
  if (!productName && leadInterest) return leadInterest;
  if (!productName) return '6wk_gym';
  const lower = productName.toLowerCase();
  if (lower.includes('12') || lower.includes('flagship') || lower.includes('custom')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40')) return '40plus';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('zoom') && lower.includes('pack')) return 'zoom_pack';
  return leadInterest || '6wk_gym';
}
