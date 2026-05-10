const { getSupabase } = require('../lib/supabase');
const { sendTemplate, maskPhone } = require('../lib/whatsapp');
const { PROGRAM_CHECKOUT } = require('../lib/utils');
const crypto = require('crypto');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).json({ ok: true });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify webhook signature if secret is configured
  if (process.env.EXLY_WEBHOOK_SECRET) {
    const signature = req.headers['x-exly-signature'] || '';
    const rawBody = JSON.stringify(req.body);
    const expected = crypto
      .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
      .update(rawBody)
      .digest('hex');

    if (signature !== expected) {
      console.error('Invalid Exly webhook signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }

  const db = getSupabase();

  try {
    const {
      buyer_phone,
      buyer_name,
      buyer_email,
      product_name,
      amount,
      checkout_id,
      status,
    } = req.body;

    if (status !== 'completed' && status !== 'success') {
      // Payment not completed — notify Maddy of failure for active clients
      if (status === 'failed') {
        const { data: existingClient } = await db.from('clients')
          .select('*')
          .eq('phone', buyer_phone)
          .eq('status', 'active')
          .single();

        if (existingClient) {
          const { sendText } = require('../lib/whatsapp');
          await sendText('+917082478374',
            `⚠️ Payment failed for active client: ${buyer_name || maskPhone(buyer_phone)}\nAmount: $${amount / 100}\nProduct: ${product_name}`
          );
        }
      }
      return res.status(200).json({ action: 'payment_not_completed' });
    }

    const phone = buyer_phone;

    // Map product to program key
    let programKey = null;
    const pName = (product_name || '').toLowerCase();
    if (pName.includes('6') && pName.includes('gym')) programKey = '6wk_gym';
    else if (pName.includes('6') && pName.includes('home')) programKey = '6wk_home';
    else if (pName.includes('6')) programKey = '6wk_gym';
    else if (pName.includes('12') || pName.includes('flagship') || pName.includes('custom')) programKey = '12wk';
    else if (pName.includes('pcos')) programKey = 'pcos';
    else if (pName.includes('40')) programKey = '40plus';
    else if (pName.includes('trial')) programKey = 'zoom_trial';
    else if (pName.includes('zoom') && pName.includes('pack')) programKey = 'zoom_pack';
    else programKey = '6wk_gym';

    // Calculate program end date
    const programWeeks = programKey.startsWith('12') ? 12 : 6;
    const endsAt = new Date();
    endsAt.setDate(endsAt.getDate() + programWeeks * 7);

    // Find existing lead
    const { data: lead } = await db.from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    // Update lead status to converted
    if (lead) {
      await db.from('leads').update({
        status: 'converted',
        last_msg_at: new Date().toISOString(),
      }).eq('id', lead.id);
    }

    // Create client record
    const clientId = crypto.randomUUID();
    const folderUrl = `/clients/${clientId}/`;

    const { data: client, error: clientErr } = await db.from('clients').insert({
      id: clientId,
      lead_id: lead?.id || null,
      phone,
      name: buyer_name,
      email: buyer_email,
      program: programKey,
      program_started_at: new Date().toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: amount,
      checkout_id,
      folder_url: folderUrl,
      status: 'active',
    }).select().single();

    if (clientErr) {
      console.error('Client creation error:', clientErr.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    // Create storage folder
    try {
      await db.storage.from('clients').upload(
        `${clientId}/.keep`,
        new Uint8Array(0),
        { contentType: 'text/plain' }
      );
    } catch (e) {
      console.log('Storage folder creation skipped:', e.message);
    }

    // Send onboarding WhatsApp template
    await sendTemplate(phone, `onboard_${programKey}`, [
      buyer_name || 'Champion',
      PROGRAM_CHECKOUT[programKey]?.name || 'your program',
    ]);

    await db.from('messages').insert({
      phone,
      direction: 'out',
      body: `Onboarding message sent for ${programKey}`,
      template_name: `onboard_${programKey}`,
      sent_at: new Date().toISOString(),
      status: 'sent',
    });

    // For 12-week program: trigger Week 1 program generation
    if (programKey === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://fitnessbymaddy.com';

        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: clientId, week_no: 1 }),
        });
      } catch (e) {
        console.error('Week 1 program generation failed:', e.message);
      }
    }

    console.log(`New client: ${maskPhone(phone)} → ${programKey}`);
    return res.status(200).json({
      success: true,
      client_id: clientId,
      program: programKey,
    });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
