const crypto = require('crypto');
const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');
const { getProgramByKey } = require('./lib/programs');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getSupabase();

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

    const {
      event, buyer_name, buyer_email, buyer_phone,
      product_name, amount, checkout_id, currency
    } = req.body;

    if (event !== 'purchase.completed' && event !== 'payment.success') {
      return res.status(200).json({ status: 'ignored', event });
    }

    const phone = buyer_phone.startsWith('+') ? buyer_phone : '+' + buyer_phone;

    const programKey = inferProgramKey(product_name, amount);
    const program = getProgramByKey(programKey);

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    const leadId = lead ? lead.id : null;

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const now = new Date();
    const programEnd = new Date(now);
    programEnd.setDate(programEnd.getDate() + (program ? program.duration_weeks * 7 : 42));

    const { data: client, error: clientErr } = await db.from('clients').insert({
      lead_id: leadId,
      phone,
      name: buyer_name,
      email: buyer_email,
      program: programKey,
      program_started_at: now.toISOString(),
      program_ends_at: programEnd.toISOString(),
      paid_amount: amount,
      checkout_id: checkout_id || null,
      status: 'active'
    }).select().single();

    if (clientErr) {
      console.error('Client insert error:', clientErr.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    const folderPath = `clients/${client.id}`;
    await db.storage.from('programs').upload(
      `${folderPath}/.keep`,
      new Uint8Array(0),
      { contentType: 'application/octet-stream', upsert: true }
    );

    await db.from('clients').update({
      folder_url: folderPath
    }).eq('id', client.id);

    await sendWhatsApp(phone, `onboard_${programKey}`, {
      name: buyer_name,
      templateParams: [
        buyer_name,
        program ? program.name : product_name,
        `$${amount}`
      ]
    }, true);

    if (programKey === '12wk') {
      try {
        const baseUrl = `https://${req.headers.host}`;
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`
          },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (genErr) {
        console.error('Week 1 program gen failed:', genErr.message);
      }
    }

    const { Resend } = require('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: 'Fitness by Maddy <support@fitnessbymaddy.com>',
      to: buyer_email,
      subject: `Welcome to ${program ? program.name : 'Fitness by Maddy'}!`,
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:40px 20px;">
          <h1 style="color:#2C2C2C;font-size:24px;">Welcome, ${buyer_name}!</h1>
          <p style="color:#6B6B6B;line-height:1.6;">
            Your ${program ? program.name : 'program'} is confirmed.
            You'll receive your program details on WhatsApp shortly.
          </p>
          <p style="color:#6B6B6B;line-height:1.6;">
            If you have any questions, reply to this email or message us on WhatsApp.
          </p>
          <p style="color:#B8965A;font-weight:600;">— Team Fitness by Maddy</p>
        </div>
      `
    });

    return res.status(200).json({ success: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
};

function inferProgramKey(productName, amount) {
  const lower = (productName || '').toLowerCase();
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40+') || lower.includes('40 plus')) return '40plus';
  if (lower.includes('12') || lower.includes('flagship') || lower.includes('custom')) return '12wk';
  if (lower.includes('zoom') && lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('zoom') && lower.includes('pack')) return 'zoom_pack';
  if (lower.includes('home')) return '6wk_home';
  if (amount >= 150) return '12wk';
  if (amount <= 25) return 'zoom_trial';
  if (amount <= 50) return 'pcos';
  return '6wk_gym';
}
