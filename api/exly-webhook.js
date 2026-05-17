const crypto = require('crypto');
const { getSupabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { PROGRAM_DETAILS } = require('../lib/utils');

function verifySignature(body, signature) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true;
  if (!signature) return false;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(body))
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  );
}

function mapCheckoutToProgram(checkoutId) {
  if (!checkoutId) return null;
  const slug = checkoutId.toLowerCase();
  for (const [key, details] of Object.entries(PROGRAM_DETAILS)) {
    if (slug.includes(details.checkoutSlug)) return key;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const signature = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'];
    if (!verifySignature(req.body, signature)) {
      return res.status(401).json({ error: 'invalid signature' });
    }

    const {
      phone,
      email,
      name,
      checkout_id,
      amount,
      product_name,
    } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone required' });

    const db = getSupabase();
    const program = mapCheckoutToProgram(checkout_id || product_name);
    const programInfo = program ? PROGRAM_DETAILS[program] : null;
    const weeks = programInfo ? programInfo.weeks : 6;

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (lead) {
      await db.from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const programEnds = new Date();
    programEnds.setDate(programEnds.getDate() + weeks * 7);

    const folderPath = `clients/${Date.now()}`;

    const { data: client, error } = await db.from('clients').insert({
      lead_id: lead ? lead.id : null,
      phone,
      name: name || (lead ? lead.name : null),
      email,
      program: program || '6wk_gym',
      program_started_at: new Date().toISOString(),
      program_ends_at: programEnds.toISOString(),
      paid_amount: amount ? parseInt(amount) : 0,
      checkout_id,
      folder_url: folderPath,
      status: 'active',
    }).select().single();

    if (error) throw error;

    const templateName = program ? `onboard_${program}` : 'onboard_general';
    await sendTemplate(phone, templateName, [
      name || 'Champion',
      programInfo ? programInfo.name : 'your program',
    ], true);

    return res.json({ ok: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'internal' });
  }
};
