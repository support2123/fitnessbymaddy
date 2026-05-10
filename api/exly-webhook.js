const { getSupabase } = require('../lib/supabase');
const { sendTemplate, detectMarket } = require('../lib/whatsapp');
const { PROGRAM_DURATIONS_WEEKS, cors, parseBody } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const supabase = getSupabase();

  let body;
  try {
    body = await parseBody(req);
  } catch {
    return res.status(400).json({ error: 'Invalid body' });
  }

  const secret = req.headers['x-exly-secret'] || req.headers['x-webhook-secret'];
  if (process.env.EXLY_WEBHOOK_SECRET && secret !== process.env.EXLY_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Invalid webhook secret' });
  }

  const phone = body.phone || body.customer_phone || '';
  const email = body.email || body.customer_email || '';
  const name = body.name || body.customer_name || '';
  const program = body.program || body.product_name || '';
  const amount = parseFloat(body.amount || body.paid_amount || 0);
  const checkoutId = body.checkout_id || body.order_id || '';

  if (!phone) return res.status(400).json({ error: 'No phone' });

  const programKey = mapExlyProgram(program);

  const { data: lead } = await supabase
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  const leadId = lead?.id || null;

  if (lead) {
    await supabase
      .from('leads')
      .update({ status: 'converted' })
      .eq('id', lead.id);
  }

  const now = new Date();
  const weeks = PROGRAM_DURATIONS_WEEKS[programKey] || 6;
  const endsAt = new Date(now.getTime() + weeks * 7 * 24 * 60 * 60 * 1000);

  const { data: client, error } = await supabase
    .from('clients')
    .insert({
      lead_id: leadId,
      phone,
      name: name || lead?.name || '',
      email,
      program: programKey,
      program_started_at: now.toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: amount,
      checkout_id: checkoutId,
      folder_url: null,
      status: 'active',
    })
    .select()
    .single();

  if (error) {
    return res.status(500).json({ error: 'Failed to create client' });
  }

  const folderPath = `clients/${client.id}`;
  await supabase.storage
    .from('client-files')
    .upload(`${folderPath}/.keep`, new Blob(['']));

  await supabase
    .from('clients')
    .update({ folder_url: folderPath })
    .eq('id', client.id);

  await sendTemplate(phone, `onboard_${programKey}`, [
    name || 'there',
    `${weeks} weeks`,
  ], { supabase });

  if (programKey === '12wk') {
    try {
      const origin = `https://${req.headers.host}`;
      await fetch(`${origin}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: client.id, week_no: 1 }),
      });
    } catch {}
  }

  return res.status(200).json({ ok: true, client_id: client.id });
};

function mapExlyProgram(name) {
  if (!name) return '6wk_gym';
  const lower = name.toLowerCase();
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40') || lower.includes('plus') || lower.includes('strong')) return '40plus';
  if (lower.includes('12') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('zoom') && lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('zoom') && lower.includes('pack')) return 'zoom_pack';
  if (lower.includes('home')) return '6wk_home';
  return '6wk_gym';
}
