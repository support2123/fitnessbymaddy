const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { programLabel, parseBody, cors, maskPhone } = require('../lib/helpers');
const { escalate } = require('../lib/escalation');

const PROGRAM_DURATION = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 28
};

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const supabase = getSupabase();

  try {
    const body = await parseBody(req);

    const secret = req.headers['x-webhook-secret'] || req.headers['x-exly-secret'];
    if (process.env.EXLY_WEBHOOK_SECRET && secret !== process.env.EXLY_WEBHOOK_SECRET) {
      return res.status(401).json({ error: 'Invalid webhook secret' });
    }

    const phone = body.phone || body.customer_phone || body.mobile || '';
    const email = body.email || body.customer_email || '';
    const name = body.name || body.customer_name || '';
    const checkoutId = body.checkout_id || body.order_id || body.transaction_id || '';
    const amount = body.amount || body.paid_amount || 0;
    const productName = body.product_name || body.program || '';

    if (!phone) {
      return res.status(400).json({ error: 'Phone number required' });
    }

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    let program = lead?.program_interest || '6wk_gym';
    if (productName) {
      const lower = productName.toLowerCase();
      if (lower.includes('12') || lower.includes('custom') || lower.includes('flagship')) program = '12wk';
      else if (lower.includes('pcos')) program = 'pcos';
      else if (lower.includes('40')) program = '40plus';
      else if (lower.includes('trial') || lower.includes('zoom')) program = 'zoom_trial';
      else if (lower.includes('home')) program = '6wk_home';
    }

    const durationDays = PROGRAM_DURATION[program] || 42;
    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + durationDays * 24 * 60 * 60 * 1000);

    const { data: client, error: insertError } = await supabase
      .from('clients')
      .insert({
        lead_id: lead?.id || null,
        phone,
        name: name || lead?.name || null,
        email: email || null,
        program,
        program_started_at: startDate.toISOString(),
        program_ends_at: endDate.toISOString(),
        paid_amount: parseInt(amount),
        checkout_id: checkoutId,
        folder_url: null,
        status: 'active'
      })
      .select('id')
      .single();

    if (insertError) {
      console.error('[Exly] Client insert error:', insertError.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    if (lead) {
      await supabase.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const folderPath = `clients/${client.id}`;
    await supabase.storage.from('client-files').upload(
      `${folderPath}/.keep`,
      new Blob([''], { type: 'text/plain' })
    );

    await supabase
      .from('clients')
      .update({ folder_url: folderPath })
      .eq('id', client.id);

    const label = programLabel(program);
    await sendWhatsApp(phone, `onboard_${program}`, {
      name: name || 'there',
      templateParams: [name || 'there', label]
    }, `Welcome to ${label}! Your program starts now.`);

    if (program === '12wk') {
      try {
        const origin = `https://${req.headers.host || 'fitnessbymaddy.com'}`;
        fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (e) {
        console.error('[Exly] Failed to trigger Week-1 program:', e.message);
      }
    }

    console.log(`[Exly] Converted ${maskPhone(phone)} → ${program}, client ${client.id}`);
    return res.status(200).json({ ok: true, client_id: client.id, program });
  } catch (err) {
    console.error('[Exly Webhook] Error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
