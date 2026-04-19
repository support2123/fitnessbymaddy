const crypto = require('crypto');
const { supabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { handleCors, maskPhone, programDisplayName } = require('../lib/helpers');

function verifyExlySignature(payload, signature, secret) {
  if (!secret) return true;
  const computed = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(payload))
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(computed),
    Buffer.from(signature || '')
  );
}

function programDurationWeeks(program) {
  const durations = {
    '6wk_gym': 6, '6wk_home': 6, '12wk': 12,
    'pcos': 8, '40plus': 8, 'zoom_trial': 1, 'zoom_pack': 4
  };
  return durations[program] || 6;
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const signature = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'];
    const secret = process.env.EXLY_WEBHOOK_SECRET;

    if (secret && !verifyExlySignature(req.body, signature, secret)) {
      console.error('[Exly] Invalid webhook signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const {
      customer_phone,
      customer_name,
      customer_email,
      product_name,
      amount,
      checkout_id,
      status: paymentStatus
    } = req.body;

    if (paymentStatus !== 'completed' && paymentStatus !== 'success') {
      const { data: existingClient } = await supabase
        .from('clients')
        .select('phone')
        .eq('checkout_id', checkout_id)
        .single();

      if (existingClient) {
        const { createEscalation } = require('../lib/escalation');
        await createEscalation(
          existingClient.phone,
          'Payment failure for active client',
          `Checkout ${checkout_id} status: ${paymentStatus}`,
          null
        );
      }
      return res.status(200).json({ action: 'payment_not_completed' });
    }

    const phone = (customer_phone || '').replace(/[^0-9]/g, '');
    if (!phone) return res.status(400).json({ error: 'No phone number' });

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    let program = lead?.program_interest || '6wk_gym';

    const productLower = (product_name || '').toLowerCase();
    if (productLower.includes('12') || productLower.includes('custom')) program = '12wk';
    else if (productLower.includes('pcos')) program = 'pcos';
    else if (productLower.includes('40')) program = '40plus';
    else if (productLower.includes('trial') || productLower.includes('zoom')) program = 'zoom_trial';
    else if (productLower.includes('shred') || productLower.includes('6')) program = '6wk_gym';

    if (lead) {
      await supabase
        .from('leads')
        .update({ status: 'converted', program_interest: program })
        .eq('id', lead.id);
    }

    const weeks = programDurationWeeks(program);
    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + weeks * 7 * 24 * 60 * 60 * 1000);

    const { data: client, error } = await supabase
      .from('clients')
      .insert({
        lead_id: lead?.id,
        phone,
        name: customer_name || lead?.name,
        email: customer_email,
        program,
        program_started_at: startDate.toISOString(),
        program_ends_at: endDate.toISOString(),
        paid_amount: amount ? parseInt(amount) : null,
        checkout_id,
        folder_url: `clients/${null}/`,
        status: 'active'
      })
      .select()
      .single();

    if (error) {
      console.error(`[Exly] Client insert failed for ${maskPhone(phone)}:`, error.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    await supabase
      .from('clients')
      .update({ folder_url: `clients/${client.id}/` })
      .eq('id', client.id);

    await sendTemplate(phone, `onboard_${program}`, [
      customer_name || 'there',
      programDisplayName(program)
    ]);

    if (program === '12wk') {
      try {
        const baseUrl = `https://${req.headers.host}`;
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (genErr) {
        console.error('[Exly] Week 1 program gen failed:', genErr.message);
      }
    }

    const { Resend } = require('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);

    if (customer_email && process.env.RESEND_API_KEY) {
      await resend.emails.send({
        from: 'Fitness by Maddy <support@fitnessbymaddy.com>',
        to: customer_email,
        subject: `Welcome to ${programDisplayName(program)}!`,
        html: `
          <div style="font-family: 'DM Sans', sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: #2C2C2C; padding: 32px; text-align: center;">
              <h1 style="color: #B8965A; font-size: 24px; margin: 0;">FITNESS BY MADDY</h1>
            </div>
            <div style="padding: 32px; background: #FAF8F4;">
              <h2 style="color: #2C2C2C; font-size: 22px;">Welcome, ${customer_name || 'there'}!</h2>
              <p style="color: #6B6B6B; line-height: 1.7;">
                You're officially in! Your <strong>${programDisplayName(program)}</strong> starts now.
              </p>
              <p style="color: #6B6B6B; line-height: 1.7;">
                Here's what happens next:
              </p>
              <ul style="color: #6B6B6B; line-height: 2;">
                <li>You'll receive your program details on WhatsApp</li>
                <li>Weekly check-in forms will be sent every Sunday</li>
                <li>Reply on WhatsApp anytime you need support</li>
              </ul>
              <p style="color: #6B6B6B; line-height: 1.7;">Let's get after it!</p>
              <p style="color: #B8965A; font-weight: 600;">— Maddy</p>
            </div>
            <div style="background: #2C2C2C; padding: 16px; text-align: center;">
              <p style="color: rgba(255,255,255,0.5); font-size: 12px; margin: 0;">fitnessbymaddy.com | @fitnessbymaddy_</p>
            </div>
          </div>
        `
      });
    }

    return res.status(200).json({
      success: true,
      action: 'client_created',
      client_id: client.id,
      program
    });
  } catch (err) {
    console.error('[Exly] Error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
