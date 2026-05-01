const crypto = require('crypto');
const { getSupabase } = require('./_lib/supabase');
const { sendTemplate } = require('./_lib/whatsapp');
const { escalateToMaddy } = require('./_lib/escalation');

const PROGRAM_DURATION = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 30,
};

function verifySignature(body, signature) {
  if (!process.env.EXLY_WEBHOOK_SECRET) return true;
  const expected = crypto
    .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
    .update(JSON.stringify(body))
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature || ''),
    Buffer.from(expected)
  );
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const signature = req.headers['x-exly-signature'] || '';
  let signatureValid = true;
  try {
    signatureValid = verifySignature(req.body, signature);
  } catch (_) {
    signatureValid = false;
  }
  if (!signatureValid) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const db = getSupabase();
  const {
    checkout_id, phone, email, name, amount, product_name,
  } = req.body;

  if (!phone) return res.status(400).json({ error: 'Missing phone' });

  const { data: lead } = await db
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .maybeSingle();

  const program = lead?.program_interest || mapProductToProgram(product_name) || '6wk_gym';
  const durationDays = PROGRAM_DURATION[program] || 42;
  const programEnds = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString();

  if (lead) {
    await db.from('leads')
      .update({ status: 'converted' })
      .eq('id', lead.id);
  }

  const { data: existingClient } = await db
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .eq('status', 'active')
    .maybeSingle();

  if (existingClient) {
    return res.json({ ok: true, message: 'Client already active', client_id: existingClient.id });
  }

  const folderPath = `clients/${crypto.randomUUID()}`;

  const { data: client, error } = await db.from('clients').insert({
    lead_id: lead?.id || null,
    phone,
    name: name || lead?.name || null,
    email: email || null,
    program,
    program_started_at: new Date().toISOString(),
    program_ends_at: programEnds,
    paid_amount: amount ? parseInt(amount, 10) : null,
    checkout_id: checkout_id || null,
    folder_url: folderPath,
    status: 'active',
  }).select().single();

  if (error) {
    await escalateToMaddy('Payment received but client creation failed', phone, JSON.stringify(error));
    return res.status(500).json({ error: 'Client creation failed' });
  }

  const templateName = `onboard_${program}`;
  await sendTemplate(phone, templateName, [name || 'there']);

  if (program === '12wk') {
    try {
      const origin = `https://${req.headers.host}`;
      await fetch(`${origin}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: client.id, week_no: 1 }),
      });
    } catch (_) {
      // async generation; failures logged internally
    }
  }

  return res.json({ ok: true, client_id: client.id });
};

function mapProductToProgram(productName) {
  if (!productName) return null;
  const lower = productName.toLowerCase();
  if (lower.includes('12') || lower.includes('flagship')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40')) return '40plus';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('trial') || lower.includes('zoom')) return 'zoom_trial';
  if (lower.includes('shred') || lower.includes('burn') || lower.includes('6')) return '6wk_gym';
  return null;
}
