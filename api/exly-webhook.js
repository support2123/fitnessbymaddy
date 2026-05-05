const crypto = require('crypto');
const { supabase } = require('./lib/supabase');
const { sendTemplate, normalizePhone, detectMarket } = require('./lib/whatsapp');

function verifySignature(body, signature) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true;
  const expected = crypto.createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature || ''), Buffer.from(expected));
}

function programEndDate(program, startDate) {
  const start = new Date(startDate);
  const weeks = program === '12wk' ? 12 : program.startsWith('6wk') ? 6 : 4;
  start.setDate(start.getDate() + weeks * 7);
  return start.toISOString();
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const signature = req.headers['x-exly-signature'] || '';
    if (process.env.EXLY_WEBHOOK_SECRET && !verifySignature(req.body, signature)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const { customer_name, customer_phone, customer_email, product_name, amount, order_id } = req.body;

    if (!customer_phone) {
      return res.status(400).json({ error: 'Missing phone' });
    }

    const phone = normalizePhone(customer_phone);
    const market = detectMarket(phone);

    let program = 'zoom_trial';
    const pLower = (product_name || '').toLowerCase();
    if (pLower.includes('12') || pLower.includes('custom') || pLower.includes('flagship')) program = '12wk';
    else if (pLower.includes('pcos')) program = 'pcos';
    else if (pLower.includes('40') || pLower.includes('strong')) program = '40plus';
    else if (pLower.includes('home')) program = '6wk_home';
    else if (pLower.includes('shred') || pLower.includes('burn') || pLower.includes('6')) program = '6wk_gym';
    else if (pLower.includes('zoom') || pLower.includes('trial')) program = 'zoom_trial';
    else if (pLower.includes('pack')) program = 'zoom_pack';

    const { data: lead } = await supabase
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (lead) {
      await supabase
        .from('leads')
        .update({ status: 'converted', program_interest: program })
        .eq('id', lead.id);
    }

    const now = new Date().toISOString();
    const { data: client, error } = await supabase
      .from('clients')
      .insert({
        lead_id: lead?.id || null,
        phone,
        name: customer_name,
        email: customer_email,
        program,
        program_started_at: now,
        program_ends_at: programEndDate(program, now),
        paid_amount: amount ? Math.round(parseFloat(amount) * 100) : null,
        checkout_id: order_id,
        status: 'active'
      })
      .select()
      .single();

    if (error) {
      console.error('Client insert error:', error.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    const folderPath = `clients/${client.id}`;
    await supabase.storage.from('client-files').upload(`${folderPath}/.keep`, new Blob(['']));

    await supabase
      .from('clients')
      .update({ folder_url: folderPath })
      .eq('id', client.id);

    const templateName = market === 'IN' ? `onboard_${program}_hi` : `onboard_${program}`;
    await sendTemplate(phone, templateName, [customer_name || 'there']);

    if (program === '12wk') {
      try {
        const origin = `https://${req.headers.host}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (e) {
        console.error('Week-1 program generation failed:', e.message);
      }
    }

    return res.status(200).json({ ok: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
