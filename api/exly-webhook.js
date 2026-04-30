const crypto = require('crypto');
const { getSupabase } = require('../lib/supabase');
const { sendTemplate, maskPhone } = require('../lib/whatsapp');
const { logMessage } = require('../lib/rate-limit');

const PROGRAM_DURATIONS = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 28,
};

function verifyWebhookSignature(req) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true;

  const signature = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'] || '';
  const rawBody = JSON.stringify(req.body);
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    if (!verifyWebhookSignature(req)) {
      console.error('Invalid Exly webhook signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const {
      phone, name, email, amount, checkout_id,
      product_name, product_id,
    } = req.body;

    if (!phone) return res.status(400).json({ error: 'Phone required' });

    const db = getSupabase();

    const programKey = detectProgram(product_name || product_id || '');
    const durationDays = PROGRAM_DURATIONS[programKey] || 42;
    const now = new Date();
    const endDate = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

    const { data: lead } = await db
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .single();

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const { data: client, error } = await db.from('clients').insert({
      lead_id: lead?.id || null,
      phone,
      name: name || null,
      email: email || null,
      program: programKey,
      program_started_at: now.toISOString(),
      program_ends_at: endDate.toISOString(),
      paid_amount: amount ? parseInt(amount, 10) : null,
      checkout_id: checkout_id || null,
      folder_url: null,
      status: 'active',
    }).select('id').single();

    if (error) {
      console.error('Client insert error:', error.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    const folderPath = `clients/${client.id}`;
    await db.from('clients').update({ folder_url: folderPath }).eq('id', client.id);

    const templateName = `onboard_${programKey}`;
    await sendTemplate(phone, templateName, [name || 'there']);
    await logMessage({
      phone,
      direction: 'out',
      templateName,
      body: `Welcome onboard! Your ${programKey} program starts now.`,
    });

    if (programKey === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://www.fitnessbymaddy.com';

        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch (genErr) {
        console.error('Week 1 program gen failed:', genErr.message);
      }
    }

    return res.status(200).json({ success: true, clientId: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function detectProgram(productStr) {
  const lower = (productStr || '').toLowerCase();
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40')) return '40plus';
  if (lower.includes('12') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('zoom') && lower.includes('pack')) return 'zoom_pack';
  if (lower.includes('zoom') || lower.includes('trial')) return 'zoom_trial';
  return '6wk_gym';
}
