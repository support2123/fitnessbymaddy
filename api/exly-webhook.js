const crypto = require('crypto');
const { getSupabase } = require('../lib/supabase');
const { sendTemplate, detectMarket, isHinglish } = require('../lib/whatsapp');
const { getProgramDuration } = require('../lib/qualify');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

  try {
    const secret = process.env.EXLY_WEBHOOK_SECRET;
    if (secret) {
      const sig = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'] || '';
      const expected = crypto.createHmac('sha256', secret).update(JSON.stringify(req.body)).digest('hex');
      if (sig && sig !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const {
      phone,
      email,
      name,
      amount,
      checkout_id,
      product_name,
      program
    } = req.body;

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    const programKey = program
      || lead?.program_interest
      || mapProductToProgram(product_name);

    if (lead) {
      await db.from('leads').update({
        status: 'converted',
        name: name || lead.name
      }).eq('id', lead.id);
    }

    const startDate = new Date();
    const durationDays = getProgramDuration(programKey);
    const endDate = new Date(startDate.getTime() + durationDays * 24 * 60 * 60 * 1000);

    const folderPath = `/clients/${crypto.randomUUID()}`;

    const { data: client, error } = await db.from('clients').insert({
      lead_id: lead?.id || null,
      phone,
      name: name || lead?.name,
      email,
      program: programKey,
      program_started_at: startDate.toISOString(),
      program_ends_at: endDate.toISOString(),
      paid_amount: amount ? parseInt(amount) : null,
      checkout_id,
      folder_url: folderPath,
      status: 'active'
    }).select().single();

    if (error) throw error;

    const market = lead?.market || detectMarket(phone);
    const templateName = isHinglish(market)
      ? `onboard_${programKey}_hi`
      : `onboard_${programKey}`;

    await sendTemplate(phone, templateName, [
      name || 'Champion',
      durationDays / 7 + ' weeks'
    ]);

    if (programKey === '12wk') {
      try {
        const origin = `https://${req.headers.host}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (genErr) {
        console.error('[exly-webhook] Week-1 program gen failed:', genErr.message);
      }
    }

    return res.json({ ok: true, client_id: client.id });

  } catch (err) {
    console.error('[exly-webhook] Error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function mapProductToProgram(productName) {
  if (!productName) return '6wk_gym';
  const lower = productName.toLowerCase();
  if (lower.includes('12') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40') || lower.includes('strong')) return '40plus';
  if (lower.includes('trial') || lower.includes('zoom')) return 'zoom_trial';
  if (lower.includes('home')) return '6wk_home';
  return '6wk_gym';
}
