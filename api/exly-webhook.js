const { getSupabase } = require('./lib/supabase');
const { sendTemplate, notifyMaddy } = require('./lib/whatsapp');
const {
  normalizePhone, cors, parseBody, maskPhone,
  PROGRAM_NAMES, programDurationDays
} = require('./lib/helpers');
const crypto = require('crypto');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const sb = getSupabase();

  try {
    const body = await parseBody(req);

    const webhookSecret = process.env.EXLY_WEBHOOK_SECRET;
    if (webhookSecret && body._signature) {
      const expected = crypto
        .createHmac('sha256', webhookSecret)
        .update(JSON.stringify(body.data || body))
        .digest('hex');
      if (body._signature !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const purchase = body.data || body;
    const phone = normalizePhone(purchase.phone || purchase.mobile || '');
    const email = purchase.email || '';
    const name = purchase.name || purchase.customer_name || '';
    const checkoutId = purchase.checkout_id || purchase.order_id || '';
    const paidAmount = purchase.amount ? parseInt(purchase.amount, 10) : 0;
    const productName = (purchase.product || purchase.plan || '').toLowerCase();

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone' });
    }

    let program = '6wk_gym';
    if (/12.?week|custom|flagship/.test(productName)) program = '12wk';
    else if (/pcos|warrior/.test(productName)) program = 'pcos';
    else if (/40\+|forty|strong/.test(productName)) program = '40plus';
    else if (/trial|zoom/.test(productName)) program = 'zoom_trial';
    else if (/home/.test(productName)) program = '6wk_home';
    else if (/pack/.test(productName)) program = 'zoom_pack';

    const { data: lead } = await sb
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .maybeSingle();

    if (lead) {
      await sb.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const now = new Date();
    const endsAt = new Date(now.getTime() + programDurationDays(program) * 86400000);

    const { data: client, error: clientErr } = await sb
      .from('clients')
      .upsert({
        lead_id: lead?.id || null,
        phone,
        name: name || lead?.name || '',
        email,
        program,
        program_started_at: now.toISOString(),
        program_ends_at: endsAt.toISOString(),
        paid_amount: paidAmount,
        checkout_id: checkoutId,
        status: 'active'
      }, { onConflict: 'lead_id' })
      .select()
      .single();

    if (clientErr) {
      console.error('Client upsert error:', clientErr.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    const folderPath = `${client.id}/`;
    await sb.storage.from('clients').upload(
      `${folderPath}.folder`, Buffer.from(''),
      { contentType: 'text/plain', upsert: true }
    );

    await sb.from('clients').update({ folder_url: folderPath }).eq('id', client.id);

    await sendTemplate(phone, `onboard_${program}`, [
      name || 'there',
      PROGRAM_NAMES[program]
    ]);

    if (program === '12wk') {
      try {
        const origin = `https://${req.headers.host || 'fitnessbymaddy.com'}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (err) {
        console.error('Week-1 program generation failed:', err.message);
      }
    }

    await notifyMaddy(
      'New conversion!',
      `${name || maskPhone(phone)} just purchased ${PROGRAM_NAMES[program]} ($${paidAmount / 100})`
    );

    return res.status(200).json({ success: true, client_id: client.id });

  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
