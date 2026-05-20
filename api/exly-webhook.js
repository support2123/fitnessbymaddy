const crypto = require('crypto');
const { supabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/mask-phone');

const PROGRAM_DURATION = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 30
};

function verifyWebhookSignature(body, signature) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true; // skip verification if no secret configured
  const expected = crypto.createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature || ''), Buffer.from(expected));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const signature = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'];
    if (process.env.EXLY_WEBHOOK_SECRET && !verifyWebhookSignature(req.body, signature)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const {
      phone, name, email, amount, checkout_id,
      product_name, product_id
    } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone' });
    }

    console.log(`Exly purchase: ${maskPhone(phone)}, amount: ${amount}`);

    // Find the lead
    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    const program = lead?.program_interest || detectProgram(product_name, amount);
    const durationDays = PROGRAM_DURATION[program] || 42;
    const programEnds = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString();

    // Update lead status
    if (lead) {
      await supabase
        .from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    // Create or update client
    const clientData = {
      lead_id: lead?.id || null,
      phone,
      name: name || lead?.name,
      email,
      program,
      program_started_at: new Date().toISOString(),
      program_ends_at: programEnds,
      paid_amount: amount ? Math.round(parseFloat(amount) * 100) : null,
      checkout_id: checkout_id || product_id,
      status: 'active'
    };

    const { data: client, error: clientErr } = await supabase
      .from('clients')
      .insert(clientData)
      .select()
      .single();

    if (clientErr) {
      console.error(`Client creation failed for ${maskPhone(phone)}:`, clientErr.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    // Create storage folder
    const folderPath = `clients/${client.id}/.keep`;
    await supabase.storage.from('clients').upload(folderPath, new Uint8Array(0), {
      contentType: 'application/octet-stream',
      upsert: true
    });

    await supabase
      .from('clients')
      .update({ folder_url: `clients/${client.id}/` })
      .eq('id', client.id);

    // Send onboarding WhatsApp
    await sendTemplate(phone, `onboard_${program}`, [
      (name || 'there').split(' ')[0],
      program
    ], true);

    // For 12-week clients, trigger immediate Week 1 program generation
    if (program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://www.fitnessbymaddy.com';

        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (genErr) {
        console.error('Week 1 program generation failed:', genErr.message);
      }
    }

    // Send confirmation email via Resend
    if (email) {
      try {
        const { Resend } = require('resend');
        const resend = new Resend(process.env.RESEND_API_KEY);
        await resend.emails.send({
          from: 'Fitness by Maddy <support@fitnessbymaddy.com>',
          to: email,
          subject: `Welcome to ${program === '12wk' ? 'your 12-Week Custom Program' : 'Fitness by Maddy'}!`,
          html: `<p>Hi ${(name || 'there').split(' ')[0]},</p>
<p>Welcome to Fitness by Maddy! Your program is now active.</p>
<p>You'll receive your first check-in form on WhatsApp in 7 days. In the meantime, make sure you've filled out the intake form if you haven't already.</p>
<p>Let's crush this!</p>
<p>— Team Maddy</p>`
        });
      } catch (emailErr) {
        console.error('Welcome email failed:', emailErr.message);
      }
    }

    return res.status(200).json({ ok: true, client_id: client.id });

  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function detectProgram(productName, amount) {
  if (!productName && !amount) return '6wk_gym';
  const name = (productName || '').toLowerCase();
  if (name.includes('pcos')) return 'pcos';
  if (name.includes('40')) return '40plus';
  if (name.includes('12') || name.includes('custom')) return '12wk';
  if (name.includes('trial') || name.includes('zoom')) return 'zoom_trial';
  const cents = amount ? parseFloat(amount) : 0;
  if (cents >= 150) return '12wk';
  if (cents >= 45 && cents < 50) return 'pcos';
  if (cents >= 50 && cents < 90) return '40plus';
  if (cents <= 25) return 'zoom_trial';
  return '6wk_gym';
}
