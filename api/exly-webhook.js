const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp, maskPhone } = require('./lib/whatsapp');
const { corsHeaders, parseBody, programDisplayName } = require('./lib/helpers');
const { escalateToMaddy } = require('./lib/escalate');
const crypto = require('crypto');

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = await parseBody(req);

    // Verify webhook signature if secret is configured
    const secret = process.env.EXLY_WEBHOOK_SECRET;
    if (secret && body._signature) {
      const expected = crypto
        .createHmac('sha256', secret)
        .update(JSON.stringify(body.data || body))
        .digest('hex');
      if (body._signature !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const phone = body.phone || body.customer_phone || '';
    const email = body.email || body.customer_email || '';
    const name = body.name || body.customer_name || '';
    const checkoutId = body.checkout_id || body.order_id || '';
    const amount = body.amount || body.paid_amount || 0;
    const productName = body.product_name || body.product || '';

    if (!phone) {
      return res.status(400).json({ error: 'No phone number' });
    }

    const db = getSupabase();

    // Find the lead
    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    // Determine program from product name or lead's interest
    let program = lead?.program_interest || 'zoom_trial';
    const pLower = productName.toLowerCase();
    if (pLower.includes('12') || pLower.includes('custom') || pLower.includes('flagship')) program = '12wk';
    else if (pLower.includes('pcos')) program = 'pcos';
    else if (pLower.includes('40')) program = '40plus';
    else if (pLower.includes('shred') || pLower.includes('6') || pLower.includes('burn')) program = '6wk_gym';
    else if (pLower.includes('home')) program = '6wk_home';
    else if (pLower.includes('trial')) program = 'zoom_trial';

    // Calculate program end date
    const programStart = new Date();
    const weeksDuration = program === '12wk' ? 12 : program.startsWith('6wk') ? 6 : 4;
    const programEnd = new Date(programStart.getTime() + weeksDuration * 7 * 24 * 60 * 60 * 1000);

    // Create client record
    const { data: client, error: clientErr } = await db.from('clients').insert({
      lead_id: lead?.id || null,
      phone,
      name: name || lead?.name || '',
      email,
      program,
      program_started_at: programStart.toISOString(),
      program_ends_at: programEnd.toISOString(),
      paid_amount: amount,
      checkout_id: checkoutId,
      folder_url: null,
      status: 'active'
    }).select().single();

    if (clientErr) {
      console.error('Client creation error:', clientErr.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    // Update lead status
    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    // Create storage folder
    const folderPath = `clients/${client.id}/`;
    try {
      await db.storage.from('client-files').upload(
        `${folderPath}.keep`,
        new Uint8Array(0),
        { contentType: 'application/octet-stream', upsert: true }
      );
      await db.from('clients').update({ folder_url: folderPath }).eq('id', client.id);
    } catch (storageErr) {
      console.error('Storage folder creation:', storageErr.message);
    }

    // Send welcome WhatsApp
    const templateName = `onboard_${program}`;
    await sendWhatsApp(phone, templateName, [
      name || 'there',
      programDisplayName(program)
    ], true);

    // Log conversion
    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: `[PURCHASE] ${productName} - $${amount} - checkout:${checkoutId}`,
      template_name: null,
      sent_at: new Date().toISOString(),
      status: 'received'
    });

    // If 12-week program, trigger immediate week-1 generation
    if (program === '12wk') {
      try {
        const origin = `https://${req.headers.host}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (genErr) {
        console.error('Week-1 generation trigger:', genErr.message);
      }
    }

    return res.status(200).json({ success: true, client_id: client.id });

  } catch (err) {
    console.error('Exly webhook error:', err.message);
    await escalateToMaddy('Payment webhook error', `Error: ${err.message}`).catch(() => {});
    return res.status(500).json({ error: 'Internal error' });
  }
};
