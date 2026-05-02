const crypto = require('crypto');
const { getSupabase } = require('../lib/supabase');
const { sendTemplate, sendText } = require('../lib/whatsapp');
const { logMessage } = require('../lib/messages');
const { maskPhone } = require('../lib/utils');

const MADDY_PHONE = '917082478374';

function verifySignature(body, signature) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true;
  const expected = crypto.createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature || ''), Buffer.from(expected));
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const signature = req.headers['x-exly-signature'] || '';
    if (process.env.EXLY_WEBHOOK_SECRET && !verifySignature(req.body, signature)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const {
      phone, email, name, checkout_id, amount, product_name,
    } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone required' });

    const db = getSupabase();

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .limit(1)
      .single();

    const program = mapProduct(product_name, lead?.program_interest);
    const duration = program === '12wk' ? 84 : 42;
    const now = new Date();
    const endsAt = new Date(now.getTime() + duration * 24 * 60 * 60 * 1000);

    const { data: client } = await db.from('clients').insert({
      lead_id: lead?.id || null,
      phone,
      name: name || lead?.name || '',
      email: email || '',
      program,
      program_started_at: now.toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: amount ? parseFloat(amount) : 0,
      checkout_id: checkout_id || null,
      status: 'active',
    }).select().single();

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const templateName = `onboard_${program}`;
    await sendTemplate(phone, templateName, [name || 'there']);
    await logMessage(phone, 'out', `Welcome to ${program}`, templateName);

    if (program === '12wk' && client) {
      try {
        const origin = `https://${req.headers.host}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch (_) {}
    }

    await sendText(MADDY_PHONE,
      `💰 New sale! ${name || maskPhone(phone)} just bought ${program}. Amount: $${amount || '?'}`
    );

    return res.status(200).json({ success: true, client_id: client?.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function mapProduct(productName, fallbackProgram) {
  if (!productName) return fallbackProgram || 'zoom_trial';
  const lower = productName.toLowerCase();
  if (lower.includes('12') || lower.includes('flagship') || lower.includes('custom')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40')) return '40plus';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('6') || lower.includes('shred') || lower.includes('burn')) return '6wk_gym';
  if (lower.includes('trial') || lower.includes('zoom')) return 'zoom_trial';
  if (lower.includes('pack')) return 'zoom_pack';
  return fallbackProgram || 'zoom_trial';
}
