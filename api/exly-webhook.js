const crypto = require('crypto');
const { getSupabase } = require('./lib/supabase');
const { sendTemplateForced } = require('./lib/whatsapp');
const { getProgramDurationWeeks } = require('./lib/qualify');
const { maskPhone } = require('./lib/pii');

function verifySignature(payload, signature) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true;
  const computed = crypto.createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(signature || ''));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getSupabase();
  const body = req.body;

  const signature = req.headers['x-exly-signature'] || '';
  if (process.env.EXLY_WEBHOOK_SECRET && !verifySignature(body, signature)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const phone = body.phone || body.customer_phone;
  const email = body.email || body.customer_email;
  const name = body.name || body.customer_name;
  const checkoutId = body.checkout_id || body.order_id;
  const amount = body.amount || body.paid_amount;
  const productName = (body.product_name || body.item_name || '').toLowerCase();

  if (!phone) return res.status(400).json({ error: 'No phone number' });

  try {
    let program = '6wk_gym';
    if (productName.includes('pcos')) program = 'pcos';
    else if (productName.includes('40+') || productName.includes('40 plus')) program = '40plus';
    else if (productName.includes('12') || productName.includes('custom') || productName.includes('flagship')) program = '12wk';
    else if (productName.includes('home')) program = '6wk_home';
    else if (productName.includes('zoom') && productName.includes('pack')) program = 'zoom_pack';
    else if (productName.includes('trial') || productName.includes('zoom')) program = 'zoom_trial';

    const normalizedPhone = phone.startsWith('+') ? phone : '+' + phone;
    const durationWeeks = getProgramDurationWeeks(program);
    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + durationWeeks * 7 * 24 * 60 * 60 * 1000);

    const { data: lead } = await db
      .from('leads')
      .select('id')
      .eq('phone', normalizedPhone)
      .single();

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const folderPath = `clients/${checkoutId || Date.now()}`;

    const { data: client, error: clientErr } = await db
      .from('clients')
      .insert({
        lead_id: lead?.id || null,
        phone: normalizedPhone,
        name,
        email,
        program,
        program_started_at: startDate.toISOString(),
        program_ends_at: endDate.toISOString(),
        paid_amount: parseInt(amount) || 0,
        checkout_id: checkoutId,
        folder_url: folderPath,
        status: 'active'
      })
      .select()
      .single();

    if (clientErr) {
      console.error('Client creation error:', clientErr.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    await sendTemplateForced(normalizedPhone, `onboard_${program}`, {
      name: name || 'there',
      templateParams: [name || 'there', durationWeeks.toString()]
    });

    if (program === '12wk') {
      try {
        const baseUrl = `https://${req.headers.host}`;
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (genErr) {
        console.error('Week 1 program generation failed:', genErr.message);
      }
    }

    console.log(`New client: ${maskPhone(normalizedPhone)}, program: ${program}`);
    return res.status(200).json({ ok: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
