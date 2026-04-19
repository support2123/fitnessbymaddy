const { getSupabase } = require('./_lib/supabase');
const { sendTemplate } = require('./_lib/whatsapp');
const crypto = require('crypto');

var PROGRAM_DURATIONS = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 30
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    var signature = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'];
    if (process.env.EXLY_WEBHOOK_SECRET && signature) {
      var expected = crypto
        .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (signature !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    var supabase = getSupabase();
    var b = req.body;

    var phone = b.phone || b.customer_phone || b.mobile;
    if (!phone) return res.status(400).json({ error: 'Phone required' });

    phone = phone.replace(/[^0-9+]/g, '');
    if (!phone.startsWith('+')) phone = '+' + phone;

    var name = b.name || b.customer_name || '';
    var email = b.email || b.customer_email || '';
    var program = b.product_id || b.program || b.plan || 'zoom_trial';
    var amount = b.amount || b.paid_amount || 0;
    var checkoutId = b.checkout_id || b.order_id || b.transaction_id || '';

    var leadRes = await supabase.from('leads').select('*').eq('phone', phone).single();
    var leadId = null;

    if (leadRes.data) {
      leadId = leadRes.data.id;
      await supabase.from('leads')
        .update({ status: 'converted' })
        .eq('id', leadId);
    } else {
      var insertRes = await supabase.from('leads').insert({
        phone: phone,
        name: name,
        source: 'exly',
        status: 'converted',
        program_interest: program
      }).select().single();
      if (insertRes.data) leadId = insertRes.data.id;
    }

    var now = new Date();
    var durationDays = PROGRAM_DURATIONS[program] || 42;
    var endsAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

    var clientInsert = await supabase.from('clients').insert({
      lead_id: leadId,
      phone: phone,
      name: name,
      email: email,
      program: program,
      program_started_at: now.toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: amount,
      checkout_id: checkoutId,
      folder_url: '/clients/' + (leadId || 'unknown'),
      status: 'active'
    }).select().single();

    if (clientInsert.error) {
      console.error('Client insert error:', clientInsert.error.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    var clientId = clientInsert.data.id;

    await supabase.storage.from('clients').upload(
      'clients/' + clientId + '/.keep',
      Buffer.from(''),
      { contentType: 'text/plain', upsert: true }
    );

    var templateName = 'onboard_' + program;
    await sendTemplate(phone, templateName, [name || 'there']);

    if (program === '12wk') {
      try {
        var origin = 'https://' + (req.headers.host || 'fitnessbymaddy.com');
        await fetch(origin + '/api/generate-program', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_id: clientId,
            week_no: 1
          })
        });
      } catch (genErr) {
        console.error('Week 1 program gen failed:', genErr.message);
      }
    }

    return res.status(200).json({ status: 'ok', client_id: clientId });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
