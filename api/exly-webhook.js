const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { programDurationWeeks, programLabel, corsHeaders } = require('./_lib/utils');

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const secret = req.headers['x-webhook-secret'] || req.headers['x-exly-secret'];
  if (process.env.EXLY_WEBHOOK_SECRET && secret !== process.env.EXLY_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  try {
    const {
      phone, name, email, amount, checkout_id, product_name,
    } = parseExlyPayload(req.body);

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone' });
    }

    const program = mapProductToProgram(product_name);
    const weeks = programDurationWeeks(program);
    const now = new Date();
    const endsAt = new Date(now.getTime() + weeks * 7 * 24 * 60 * 60 * 1000);

    const { data: lead } = await db
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .single();

    const leadId = lead?.id || null;

    if (leadId) {
      await db.from('leads').update({ status: 'converted' }).eq('id', leadId);
    }

    const folderPath = `clients/${Date.now()}_${phone.slice(-4)}`;

    const { data: client, error: clientErr } = await db
      .from('clients')
      .insert({
        lead_id: leadId,
        phone,
        name: name || null,
        email: email || null,
        program,
        program_started_at: now.toISOString(),
        program_ends_at: endsAt.toISOString(),
        paid_amount: amount || 0,
        checkout_id: checkout_id || null,
        folder_url: folderPath,
        status: 'active',
      })
      .select()
      .single();

    if (clientErr) {
      console.error('[Exly] Client insert error:', clientErr.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    await sendWhatsApp({
      phone,
      templateName: `onboard_${program}`,
      bodyValues: [name || 'there', programLabel(program)],
    });

    if (program === '12wk') {
      try {
        const origin = `https://${req.headers.host}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch (e) {
        console.error('[Exly] Week-1 generation trigger failed:', e.message);
      }
    }

    return res.json({ ok: true, client_id: client.id, program });
  } catch (err) {
    console.error('[Exly] Error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function parseExlyPayload(body) {
  return {
    phone: body.phone || body.customer_phone || body.mobile || '',
    name: body.name || body.customer_name || '',
    email: body.email || body.customer_email || '',
    amount: body.amount || body.paid_amount || 0,
    checkout_id: body.checkout_id || body.order_id || '',
    product_name: body.product_name || body.product || body.plan || '',
  };
}

function mapProductToProgram(productName) {
  if (!productName) return '6wk_gym';
  const lower = productName.toLowerCase();
  if (lower.includes('12') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40')) return '40plus';
  if (lower.includes('zoom') && lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('zoom')) return 'zoom_pack';
  if (lower.includes('home')) return '6wk_home';
  return '6wk_gym';
}
