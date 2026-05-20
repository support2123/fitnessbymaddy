const { supabase } = require('../lib/supabase');
const { sendTemplate, detectMarket, maskPhone } = require('../lib/whatsapp');
const crypto = require('crypto');

const PROGRAM_MAP = {
  '6_week_shred_gym': '6wk_gym',
  '6_week_shred_home': '6wk_home',
  '6_week_burn': '6wk_gym',
  '12_week_custom': '12wk',
  '12_week': '12wk',
  'pcos_warrior': 'pcos',
  'pcos': 'pcos',
  '40_plus': '40plus',
  '40plus': '40plus',
  'zoom_trial': 'zoom_trial',
  'zoom_pack': 'zoom_pack',
};

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
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true;
  const expected = crypto.createHmac('sha256', secret)
    .update(JSON.stringify(body))
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature || '', 'utf8'),
    Buffer.from(expected, 'utf8')
  );
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const signature = req.headers['x-exly-signature'];
    if (process.env.EXLY_WEBHOOK_SECRET && !verifySignature(req.body, signature)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const { phone, name, email, product, amount, checkout_id, status } = parseExlyPayload(req.body);

    if (status !== 'completed' && status !== 'paid') {
      if (status === 'failed') {
        const { data: existingClient } = await supabase
          .from('clients')
          .select('*')
          .eq('phone', phone)
          .eq('status', 'active')
          .single();

        if (existingClient) {
          const { escalateToMaddy } = require('../lib/escalation');
          await escalateToMaddy(
            'Payment failure for active client',
            `Client: ${existingClient.name} (${maskPhone(phone)})\nCheckout: ${checkout_id}`
          );
        }
      }
      return res.json({ action: 'payment_not_completed', status });
    }

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    const program = PROGRAM_MAP[product] || product || '12wk';
    const durationDays = PROGRAM_DURATION[program] || 42;
    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + durationDays * 24 * 60 * 60 * 1000);

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (lead) {
      await supabase.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const { data: client, error: clientErr } = await supabase
      .from('clients')
      .insert({
        lead_id: lead?.id || null,
        phone,
        name: name || lead?.name || null,
        email: email || null,
        program,
        program_started_at: startDate.toISOString(),
        program_ends_at: endDate.toISOString(),
        paid_amount: amount || 0,
        checkout_id: checkout_id || null,
        status: 'active',
      })
      .select()
      .single();

    if (clientErr) throw new Error(`Client insert failed: ${clientErr.message}`);

    const folderPath = `clients/${client.id}/`;
    await supabase.from('clients').update({ folder_url: folderPath }).eq('id', client.id);

    const market = detectMarket(phone);
    const templateName = market === 'IN' ? `onboard_${program}_hi` : `onboard_${program}`;
    await sendTemplate(phone, templateName, {
      name: name || 'there',
      templateParams: [name || 'there', program],
    });

    if (program === '12wk') {
      try {
        const origin = `https://${req.headers.host}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': process.env.INTERNAL_API_KEY,
          },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch (genErr) {
        console.error('Week 1 program generation failed:', genErr.message);
      }
    }

    return res.json({ ok: true, client_id: client.id, program });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Processing failed' });
  }
};

function parseExlyPayload(body) {
  return {
    phone: body.phone || body.customer_phone || body.user?.phone || '',
    name: body.name || body.customer_name || body.user?.name || '',
    email: body.email || body.customer_email || body.user?.email || '',
    product: body.product || body.product_name || body.item?.name || '',
    amount: body.amount || body.total_amount || body.payment?.amount || 0,
    checkout_id: body.checkout_id || body.order_id || body.id || '',
    status: body.status || body.payment_status || body.payment?.status || 'completed',
  };
}
