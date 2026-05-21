const { getSupabase } = require('./lib/supabase');
const { sendTemplateForced } = require('./lib/whatsapp');
const { notifyMaddy } = require('./lib/notify-maddy');

const PROGRAM_DURATIONS = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 30
};

function mapExlyProduct(productName) {
  const lower = (productName || '').toLowerCase();
  if (lower.includes('6') && lower.includes('shred')) return '6wk_gym';
  if (lower.includes('6') && lower.includes('home')) return '6wk_home';
  if (lower.includes('12') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40')) return '40plus';
  if (lower.includes('trial') || lower.includes('zoom trial')) return 'zoom_trial';
  if (lower.includes('zoom') && lower.includes('pack')) return 'zoom_pack';
  return '12wk';
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const webhookSecret = process.env.EXLY_WEBHOOK_SECRET;
  if (webhookSecret) {
    const sig = req.headers['x-exly-signature'] || req.headers['x-webhook-secret'] || '';
    if (sig !== webhookSecret) {
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }

  try {
    const body = req.body;
    const phone = body.phone || body.mobile || body.customer_phone || '';
    const email = body.email || body.customer_email || '';
    const name = body.name || body.customer_name || '';
    const productName = body.product_name || body.item_name || body.listing_name || '';
    const amount = body.amount || body.paid_amount || 0;
    const checkoutId = body.checkout_id || body.order_id || body.transaction_id || '';

    if (!phone) {
      return res.status(400).json({ error: 'No phone number in webhook' });
    }

    const db = getSupabase();
    const program = mapExlyProduct(productName);
    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + durationDays * 24 * 60 * 60 * 1000);

    let leadId = null;
    const { data: existingLead } = await db
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .single();

    if (existingLead) {
      leadId = existingLead.id;
      await db.from('leads').update({
        status: 'converted',
        program_interest: program
      }).eq('id', leadId);
    } else {
      const { data: newLead } = await db.from('leads').insert({
        phone,
        name,
        source: 'exly_purchase',
        status: 'converted',
        program_interest: program
      }).select('id').single();
      leadId = newLead?.id;
    }

    const { data: existingClient } = await db
      .from('clients')
      .select('id')
      .eq('phone', phone)
      .single();

    let clientId;
    if (existingClient) {
      clientId = existingClient.id;
      await db.from('clients').update({
        program,
        paid_amount: amount,
        checkout_id: checkoutId,
        program_started_at: startDate.toISOString(),
        program_ends_at: endDate.toISOString(),
        status: 'active',
        name: name || undefined,
        email: email || undefined
      }).eq('id', clientId);
    } else {
      const { data: newClient } = await db.from('clients').insert({
        lead_id: leadId,
        phone,
        name,
        email,
        program,
        paid_amount: amount,
        checkout_id: checkoutId,
        program_started_at: startDate.toISOString(),
        program_ends_at: endDate.toISOString(),
        folder_url: `/clients/${leadId}/`,
        status: 'active'
      }).select('id').single();
      clientId = newClient?.id;
    }

    if (clientId) {
      try {
        await db.storage.from('clients').upload(
          `${clientId}/.keep`,
          new Uint8Array(0),
          { contentType: 'application/octet-stream', upsert: true }
        );
      } catch (storageErr) {
        console.error('Storage folder creation:', storageErr.message);
      }
    }

    const templateName = `onboard_${program}`;
    await sendTemplateForced(phone, templateName, {
      name: name || 'there',
      templateParams: [
        name || 'there',
        productName || program,
        startDate.toLocaleDateString('en-IN'),
        endDate.toLocaleDateString('en-IN')
      ]
    });

    if (program === '12wk' && clientId) {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://www.fitnessbymaddy.com';
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: clientId, week_no: 1 })
        });
      } catch (err) {
        console.error('Week 1 program generation trigger failed:', err.message);
      }
    }

    return res.status(200).json({ ok: true, client_id: clientId, program });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    await notifyMaddy('Exly Webhook Error', err.message).catch(() => {});
    return res.status(500).json({ error: 'Internal error' });
  }
};
