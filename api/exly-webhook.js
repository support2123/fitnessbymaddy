const crypto = require('crypto');
const { getSupabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');

const PROGRAM_DURATIONS = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 30,
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const signature = req.headers['x-exly-signature'];
    if (process.env.EXLY_WEBHOOK_SECRET && signature) {
      const expected = crypto
        .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (signature !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const {
      customer_phone, customer_name, customer_email,
      product_name, amount, checkout_id, status,
    } = req.body;

    if (status !== 'completed' && status !== 'paid') {
      return res.status(200).json({ action: 'ignored', reason: 'not paid' });
    }

    if (!customer_phone) {
      return res.status(400).json({ error: 'Missing customer phone' });
    }

    const db = getSupabase();
    const phone = customer_phone.replace(/[^0-9+]/g, '');

    const program = detectProgram(product_name);
    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const programEnd = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000);

    const { data: lead } = await db
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const { data: existingClient } = await db
      .from('clients')
      .select('id')
      .eq('phone', phone)
      .eq('status', 'active')
      .single();

    if (existingClient) {
      return res.status(200).json({ action: 'already_active', client_id: existingClient.id });
    }

    const { data: client } = await db.from('clients').insert({
      lead_id: lead?.id,
      phone,
      name: customer_name,
      email: customer_email,
      program,
      program_started_at: new Date().toISOString(),
      program_ends_at: programEnd.toISOString(),
      paid_amount: amount ? Math.round(parseFloat(amount) * 100) : null,
      checkout_id,
      status: 'active',
    }).select('id').single();

    const clientId = client?.id;

    await db.storage.from('clients').upload(
      `${clientId}/.folder`,
      'created',
      { contentType: 'text/plain', upsert: true }
    );

    const templateName = `onboard_${program}`;
    await sendTemplate(phone, templateName, [customer_name || 'Champion']);

    if (program === '12wk') {
      try {
        const origin = `https://${req.headers.host}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: clientId, week_no: 1 }),
        });
      } catch (e) {
        console.error('Initial program gen failed:', e.message);
      }
    }

    return res.status(200).json({ action: 'converted', client_id: clientId, program });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function detectProgram(productName) {
  if (!productName) return '6wk_gym';
  const lower = productName.toLowerCase();
  if (lower.includes('12') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40') || lower.includes('strong')) return '40plus';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('trial') || lower.includes('zoom')) return 'zoom_trial';
  if (lower.includes('pack')) return 'zoom_pack';
  return '6wk_gym';
}
