const crypto = require('crypto');
const { getSupabase } = require('./_utils/supabase');
const { sendTemplate, notifyMaddy } = require('./_utils/whatsapp');
const { maskPhone } = require('./_utils/market');

const PROGRAM_MAP = {
  '6wk-burn': { program: '6wk_gym', weeks: 6, template: 'onboard_6wk' },
  '6wk-home': { program: '6wk_home', weeks: 6, template: 'onboard_6wk' },
  '12wk-custom': { program: '12wk', weeks: 12, template: 'onboard_12wk' },
  'pcos-warrior': { program: 'pcos', weeks: 8, template: 'onboard_pcos' },
  '40plus-strong': { program: '40plus', weeks: 8, template: 'onboard_40plus' },
  'zoom-trial': { program: 'zoom_trial', weeks: 1, template: 'onboard_trial' },
  'zoom-pack': { program: 'zoom_pack', weeks: 4, template: 'onboard_zoom' }
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

  try {
    if (process.env.EXLY_WEBHOOK_SECRET) {
      const sig = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'] || '';
      const expected = crypto
        .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
        .update(JSON.stringify(req.body))
        .digest('hex');

      if (sig && sig !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const payload = req.body;
    const phone = normalizePhone(payload.phone || payload.customer_phone || payload.mobile || '');
    const name = payload.name || payload.customer_name || '';
    const email = payload.email || payload.customer_email || '';
    const amount = payload.amount || payload.paid_amount || 0;
    const checkoutId = payload.checkout_id || payload.product_id || payload.order_id || '';
    const productSlug = payload.product_slug || payload.checkout_slug || checkoutId;

    if (!phone) return res.status(400).json({ error: 'No phone number in payload' });

    const programInfo = PROGRAM_MAP[productSlug] || { program: '12wk', weeks: 12, template: 'onboard_12wk' };

    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + programInfo.weeks * 7);

    let leadId = null;
    const { data: lead } = await db.from('leads')
      .select('id')
      .eq('phone', phone)
      .limit(1)
      .single();

    if (lead) {
      leadId = lead.id;
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    } else {
      const { data: newLead } = await db.from('leads').insert({
        phone, name, source: 'exly_purchase', status: 'converted'
      }).select().single();
      leadId = newLead.id;
    }

    const { data: existingClient } = await db.from('clients')
      .select('id')
      .eq('phone', phone)
      .eq('status', 'active')
      .limit(1)
      .single();

    if (existingClient) {
      return res.json({ success: true, message: 'Client already active', client_id: existingClient.id });
    }

    const { data: client } = await db.from('clients').insert({
      lead_id: leadId,
      phone,
      name,
      email,
      program: programInfo.program,
      program_started_at: startDate.toISOString(),
      program_ends_at: endDate.toISOString(),
      paid_amount: parseInt(amount),
      checkout_id: checkoutId,
      folder_url: `clients/${leadId}/`,
      status: 'active'
    }).select().single();

    await db.storage
      .from('client-files')
      .upload(`clients/${client.id}/.keep`, Buffer.from(''), { upsert: true });

    await sendTemplate(phone, programInfo.template, [name || 'there']);

    if (programInfo.program === '12wk') {
      try {
        const origin = `https://${req.headers.host}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (e) {
        console.error('Week 1 generation failed:', e.message);
      }
    }

    return res.json({
      success: true,
      client_id: client.id,
      program: programInfo.program
    });

  } catch (err) {
    console.error('Exly webhook error:', err.message);
    await notifyMaddy('Payment webhook error', err.message).catch(() => {});
    return res.status(500).json({ error: 'Internal error' });
  }
};

function normalizePhone(phone) {
  let p = phone.replace(/[^0-9+]/g, '');
  if (!p.startsWith('+')) p = '+' + p;
  return p;
}
