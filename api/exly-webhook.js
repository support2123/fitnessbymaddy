const crypto = require('crypto');
const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { json, PROGRAM_INFO, detectMarket } = require('../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return json(res, { error: 'Method not allowed' }, 405);

  const db = getSupabase();

  try {
    if (process.env.EXLY_WEBHOOK_SECRET) {
      const signature = req.headers['x-exly-signature'];
      const expected = crypto
        .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
        .update(JSON.stringify(req.body))
        .digest('hex');

      if (signature && signature !== expected) {
        return json(res, { error: 'Invalid signature' }, 401);
      }
    }

    const {
      customer_phone,
      customer_name,
      customer_email,
      product_id,
      amount,
      checkout_id,
      status
    } = req.body;

    if (status !== 'completed' && status !== 'success') {
      if (status === 'failed') {
        const { data: client } = await db
          .from('clients')
          .select('id')
          .eq('phone', customer_phone)
          .eq('status', 'active')
          .maybeSingle();

        if (client) {
          const { escalateToMaddy } = require('../lib/escalation');
          await escalateToMaddy(
            customer_phone,
            'Payment failure for active client',
            `Payment of $${amount} failed for checkout ${checkout_id}`,
            client.id
          );
        }
      }
      return json(res, { action: 'payment_not_completed', status });
    }

    const program = mapExlyProduct(product_id);
    if (!program) {
      return json(res, { error: 'Unknown product' }, 400);
    }

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', customer_phone)
      .maybeSingle();

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const programInfo = PROGRAM_INFO[program];
    const programEndsAt = new Date();
    programEndsAt.setDate(programEndsAt.getDate() + (programInfo.weeks * 7));

    const { data: client } = await db
      .from('clients')
      .insert({
        lead_id: lead?.id || null,
        phone: customer_phone,
        name: customer_name,
        email: customer_email,
        program,
        paid_amount: amount,
        checkout_id,
        program_ends_at: programEndsAt.toISOString(),
        folder_url: null,
        status: 'active'
      })
      .select()
      .single();

    const folderPath = `clients/${client.id}`;
    await db.storage.from('clients').upload(
      `${client.id}/.keep`,
      new Uint8Array(0),
      { contentType: 'application/octet-stream', upsert: true }
    );

    await db.from('clients').update({
      folder_url: folderPath
    }).eq('id', client.id);

    const market = detectMarket(customer_phone);
    const templateName = market === 'IN'
      ? `onboard_${program}_hinglish`
      : `onboard_${program}`;

    await sendWhatsApp(customer_phone, templateName, {
      name: customer_name || 'there',
      templateParams: [customer_name || 'there', programInfo.name],
      body: `Welcome to ${programInfo.name}! Your ${programInfo.weeks}-week journey starts now.`
    });

    if (program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://fitnessbymaddy.com';

        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (err) {
        console.error('Week 1 program generation failed:', err.message);
      }
    }

    return json(res, { success: true, client_id: client.id, program });

  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return json(res, { error: 'Internal error' }, 500);
  }
};

function mapExlyProduct(productId) {
  const map = {
    '6wk_gym': '6wk_gym',
    '6wk_home': '6wk_home',
    '12wk': '12wk',
    'pcos': 'pcos',
    '40plus': '40plus',
    'zoom_trial': 'zoom_trial',
    'zoom_pack': 'zoom_pack'
  };
  return map[productId] || null;
}
