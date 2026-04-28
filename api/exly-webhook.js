const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { programDurationWeeks, cors, parseBody } = require('./_lib/helpers');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();
  let body;
  try {
    body = await parseBody(req);
  } catch {
    return res.status(400).json({ error: 'Invalid body' });
  }

  const secret = req.headers['x-exly-secret'] || req.headers['x-webhook-secret'];
  if (process.env.EXLY_WEBHOOK_SECRET && secret !== process.env.EXLY_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Invalid secret' });
  }

  const phone = body.phone || body.customer_phone || '';
  const email = body.email || body.customer_email || '';
  const name = body.name || body.customer_name || '';
  const amount = body.amount || body.paid_amount || 0;
  const checkoutId = body.checkout_id || body.order_id || '';
  const program = body.product_name || body.program || '';

  if (!phone) return res.status(400).json({ error: 'No phone number' });

  const { data: lead } = await db
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .limit(1)
    .single();

  const leadId = lead ? lead.id : null;

  if (lead) {
    await db.from('leads')
      .update({ status: 'converted' })
      .eq('id', lead.id);
  }

  const programKey = detectProgramFromExly(program);
  const durationWeeks = programDurationWeeks(programKey);
  const now = new Date();
  const endsAt = new Date(now.getTime() + durationWeeks * 7 * 24 * 60 * 60 * 1000);

  const { data: client, error } = await db.from('clients').insert({
    lead_id: leadId,
    phone,
    name: name || (lead ? lead.name : ''),
    email,
    program: programKey,
    program_started_at: now.toISOString(),
    program_ends_at: endsAt.toISOString(),
    paid_amount: parseFloat(amount),
    checkout_id: checkoutId,
    status: 'active'
  }).select().single();

  if (error) return res.status(500).json({ error: 'Failed to create client' });

  const folderPath = `clients/${client.id}`;
  await db.storage.from('programs').upload(`${folderPath}/.keep`, new Uint8Array(0), {
    contentType: 'application/octet-stream',
    upsert: true
  });

  await db.from('clients')
    .update({ folder_url: folderPath })
    .eq('id', client.id);

  await sendWhatsApp(phone, `onboard_${programKey}`, [name || 'there']);

  if (programKey === '12wk') {
    try {
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'https://fitnessbymaddy.com';
      await fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: client.id, week_no: 1 })
      });
    } catch {}
  }

  return res.status(200).json({ ok: true, client_id: client.id });
};

function detectProgramFromExly(productName) {
  if (!productName) return '6wk_gym';
  const lower = productName.toLowerCase();
  if (lower.includes('12') || lower.includes('flagship') || lower.includes('custom')) return '12wk';
  if (lower.includes('pcos') || lower.includes('warrior')) return 'pcos';
  if (lower.includes('40') || lower.includes('strong')) return '40plus';
  if (lower.includes('trial') || lower.includes('zoom trial')) return 'zoom_trial';
  if (lower.includes('zoom pack') || lower.includes('session pack')) return 'zoom_pack';
  if (lower.includes('home')) return '6wk_home';
  return '6wk_gym';
}
