const { supabase } = require('../lib/supabase');
const { sendTemplate, sendText } = require('../lib/whatsapp');
const { PROGRAM_DURATIONS_WEEKS, PROGRAM_NAMES, maskPhone } = require('../lib/helpers');
const { Resend } = require('resend');

const MADDY_PHONE = '917082478374';

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const secret = req.headers['x-exly-secret'] || req.query.secret;
    if (process.env.EXLY_WEBHOOK_SECRET && secret !== process.env.EXLY_WEBHOOK_SECRET) {
      return res.status(401).json({ error: 'invalid secret' });
    }

    const payload = req.body;
    const phone = payload.phone || payload.customer_phone;
    const email = payload.email || payload.customer_email;
    const name = payload.name || payload.customer_name;
    const checkoutId = payload.checkout_id || payload.order_id;
    const amount = payload.amount || payload.paid_amount;
    const productName = (payload.product_name || payload.item_name || '').toLowerCase();

    if (!phone) return res.status(400).json({ error: 'phone required' });

    let program = null;
    if (/12.?week|custom|flagship/.test(productName)) program = '12wk';
    else if (/pcos|warrior/.test(productName)) program = 'pcos';
    else if (/40\+|forty|strong/.test(productName)) program = '40plus';
    else if (/home/.test(productName)) program = '6wk_home';
    else if (/6.?week|shred|burn/.test(productName)) program = '6wk_gym';
    else if (/trial|zoom/.test(productName)) program = 'zoom_trial';
    else if (/pack/.test(productName)) program = 'zoom_pack';
    else program = '6wk_gym';

    const durationWeeks = PROGRAM_DURATIONS_WEEKS[program] || 6;
    const endsAt = new Date();
    endsAt.setDate(endsAt.getDate() + durationWeeks * 7);

    const { data: lead } = await supabase
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .single();

    const leadId = lead?.id || null;

    if (leadId) {
      await supabase.from('leads')
        .update({ status: 'converted' })
        .eq('id', leadId);
    }

    const { data: client, error: clientErr } = await supabase.from('clients').insert({
      lead_id: leadId,
      phone,
      name,
      email,
      program,
      program_started_at: new Date().toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: amount ? parseInt(amount, 10) : null,
      checkout_id: checkoutId,
      folder_url: null,
      status: 'active',
    }).select().single();

    if (clientErr) {
      console.error('Client insert error:', clientErr.message);
      return res.status(500).json({ error: 'db error' });
    }

    const folderPath = `clients/${client.id}`;
    await supabase.storage.from('clients').upload(
      `${folderPath}/.init`, new Blob(['initialized']),
      { upsert: true }
    );

    await supabase.from('clients')
      .update({ folder_url: folderPath })
      .eq('id', client.id);

    const programName = PROGRAM_NAMES[program] || program;
    await sendText(phone,
      `Welcome to ${programName}! 🎉 You're officially in. Maddy's team will have your first plan ready soon. Let's get after it! 💪`
    );

    if (email && process.env.RESEND_API_KEY) {
      const resend = new Resend(process.env.RESEND_API_KEY);
      await resend.emails.send({
        from: 'Fitness by Maddy <support@fitnessbymaddy.com>',
        to: email,
        subject: `Welcome to ${programName}!`,
        html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
            <h1 style="color: #2C2C2C;">Welcome, ${name || 'Champion'}!</h1>
            <p>You're now enrolled in <strong>${programName}</strong>.</p>
            <p>Here's what happens next:</p>
            <ul>
              <li>Your personalized plan is being prepared</li>
              <li>You'll receive your first check-in form in 7 days</li>
              <li>Reach out on WhatsApp anytime with questions</li>
            </ul>
            <p>Let's do this! 💪</p>
            <p>— Team Maddy</p>
          </div>
        `,
      });
    }

    if (program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://www.fitnessbymaddy.com';

        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`,
          },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch (genErr) {
        console.error('Week-1 program gen failed:', genErr.message);
      }
    }

    return res.json({ ok: true, client_id: client.id, program });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'internal' });
  }
};
