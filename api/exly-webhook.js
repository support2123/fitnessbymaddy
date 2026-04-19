const { supabase } = require('./lib/supabase');
const { sendWhatsApp, maskPhone, notifyMaddy } = require('./lib/whatsapp');
const { generateToken } = require('./lib/helpers');
const crypto = require('crypto');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const signature = req.headers['x-exly-signature'];
    if (process.env.EXLY_WEBHOOK_SECRET && signature) {
      const expected = crypto
        .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (signature !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const body = req.body;
    const {
      customer_phone, customer_name, customer_email,
      product_name, amount, checkout_id, status
    } = body;

    if (status !== 'completed' && status !== 'paid') {
      if (status === 'failed') {
        const { data: client } = await supabase
          .from('clients')
          .select('*')
          .eq('phone', customer_phone)
          .eq('status', 'active')
          .single();

        if (client) {
          await notifyMaddy(
            'Payment failed',
            `Active client ${customer_name} (${maskPhone(customer_phone)}) payment failed for ${product_name}`
          );
        }
      }
      return res.status(200).json({ ok: true, action: 'ignored_status' });
    }

    let phone = customer_phone;
    if (phone && !phone.startsWith('+')) phone = '+' + phone;

    const programMap = {
      'burn': '6wk_gym',
      'shred': '6wk_gym',
      '6 week': '6wk_gym',
      'home': '6wk_home',
      'pcos': 'pcos',
      '40+': '40plus',
      '40 plus': '40plus',
      '12 week': '12wk',
      'custom': '12wk',
      'flagship': '12wk',
      'zoom trial': 'zoom_trial',
      'trial': 'zoom_trial',
      'zoom pack': 'zoom_pack'
    };

    let program = 'zoom_trial';
    const prodLower = (product_name || '').toLowerCase();
    for (const [key, val] of Object.entries(programMap)) {
      if (prodLower.includes(key)) {
        program = val;
        break;
      }
    }

    const programDurations = {
      '6wk_gym': 42,
      '6wk_home': 42,
      '12wk': 84,
      'pcos': 42,
      '40plus': 42,
      'zoom_trial': 7,
      'zoom_pack': 30
    };

    const startDate = new Date();
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + (programDurations[program] || 42));

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (lead) {
      await supabase.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const { data: client, error } = await supabase
      .from('clients')
      .upsert({
        lead_id: lead?.id || null,
        phone,
        name: customer_name,
        email: customer_email,
        program,
        program_started_at: startDate.toISOString(),
        program_ends_at: endDate.toISOString(),
        paid_amount: amount,
        checkout_id,
        status: 'active'
      }, { onConflict: 'phone' })
      .select()
      .single();

    if (error) {
      console.error('Client upsert error:', error.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    const folderPath = `clients/${client.id}`;
    await supabase.storage.from('clients').upload(
      `${folderPath}/.init`,
      new Blob(['initialized']),
      { upsert: true }
    );

    await supabase.from('clients').update({
      folder_url: folderPath
    }).eq('id', client.id);

    const market = lead?.market || 'IN';
    const welcomeMsg = market === 'IN'
      ? `Welcome to the team! 🎉 ${customer_name}, aapka ${product_name} program start ho gaya hai. Intake form zaroor fill karna: https://www.fitnessbymaddy.com/intake?lead=${lead?.id || client.id}`
      : `Welcome to the team! 🎉 ${customer_name}, your ${product_name} program has started. Please fill your intake form: https://www.fitnessbymaddy.com/intake?lead=${lead?.id || client.id}`;

    await sendWhatsApp(phone, `onboard_${program}`, {
      name: customer_name,
      templateParams: [customer_name, product_name]
    }, welcomeMsg);

    const firstCheckinDate = new Date(startDate);
    firstCheckinDate.setDate(firstCheckinDate.getDate() + 7);
    const checkinToken = generateToken();

    await supabase.from('checkins').insert({
      client_id: client.id,
      week_no: 1,
      token: checkinToken
    });

    if (program === '12wk') {
      try {
        const baseUrl = `https://${req.headers.host}`;
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (e) {
        console.error('Program generation trigger failed:', e.message);
      }
    }

    return res.status(200).json({
      ok: true,
      action: 'client_onboarded',
      client_id: client.id,
      program
    });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
