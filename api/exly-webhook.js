const { getSupabase } = require('./lib/supabase');
const { sendTemplate, maskPhone } = require('./lib/whatsapp');
const { PROGRAM_NAMES } = require('./lib/escalation');
const crypto = require('crypto');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

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
      checkout_id,
      buyer_name,
      buyer_email,
      buyer_phone,
      amount,
      product_name,
      status,
    } = req.body;

    if (status !== 'completed' && status !== 'success') {
      if (status === 'failed') {
        const db = getSupabase();
        const { data: client } = await db
          .from('clients')
          .select('phone')
          .eq('checkout_id', checkout_id)
          .single();
        if (client) {
          const { escalateToMaddy } = require('./lib/escalation');
          await escalateToMaddy(
            'Payment failed',
            `Phone: ${maskPhone(client.phone || buyer_phone)} | Amount: $${amount}`
          );
        }
      }
      return res.status(200).json({ action: 'non_completed_status' });
    }

    const db = getSupabase();

    const program = detectProgramFromProduct(product_name, amount);

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', buyer_phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    const leadId = lead?.id || null;

    if (leadId) {
      await db.from('leads').update({ status: 'converted' }).eq('id', leadId);
    }

    const programWeeks = program === '12wk' ? 12 : 6;
    const endsAt = new Date();
    endsAt.setDate(endsAt.getDate() + programWeeks * 7);

    const { data: client, error: clientErr } = await db
      .from('clients')
      .insert({
        lead_id: leadId,
        phone: buyer_phone,
        name: buyer_name,
        email: buyer_email,
        program,
        paid_amount: amount,
        checkout_id,
        program_started_at: new Date().toISOString(),
        program_ends_at: endsAt.toISOString(),
        folder_url: null,
        status: 'active',
      })
      .select()
      .single();

    if (clientErr) {
      console.error('Client insert error:', clientErr.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    const folderPath = `clients/${client.id}`;
    await db.storage.from('clients').upload(
      `${folderPath}/.keep`,
      new Blob([''], { type: 'text/plain' })
    );

    await db
      .from('clients')
      .update({ folder_url: folderPath })
      .eq('id', client.id);

    const templateName = `onboard_${program}`;
    await sendTemplate(buyer_phone, templateName, [
      buyer_name || 'there',
      PROGRAM_NAMES[program] || program,
    ]);

    if (buyer_email) {
      try {
        const { Resend } = require('resend');
        const resend = new Resend(process.env.RESEND_API_KEY);
        await resend.emails.send({
          from: 'Fitness by Maddy <support@fitnessbymaddy.com>',
          to: buyer_email,
          subject: `Welcome to ${PROGRAM_NAMES[program]}! 🎉`,
          html: `
            <div style="font-family: 'DM Sans', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #FAF8F4; padding: 40px;">
              <h1 style="font-family: Georgia, serif; color: #2C2C2C; font-size: 28px;">Welcome, ${buyer_name}!</h1>
              <p style="color: #6B6B6B; line-height: 1.8;">You're officially enrolled in <strong>${PROGRAM_NAMES[program]}</strong>.</p>
              <p style="color: #6B6B6B; line-height: 1.8;">Here's what happens next:</p>
              <ol style="color: #6B6B6B; line-height: 2;">
                <li>You'll receive your program details on WhatsApp</li>
                <li>Your first weekly check-in is in 7 days</li>
                <li>Stay consistent and trust the process</li>
              </ol>
              <p style="color: #B8965A; font-weight: 600; margin-top: 24px;">Let's make it happen. — Team Maddy</p>
            </div>
          `,
        });
      } catch (emailErr) {
        console.error('Welcome email failed:', emailErr.message);
      }
    }

    return res.status(200).json({
      success: true,
      client_id: client.id,
      program,
    });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function detectProgramFromProduct(productName, amount) {
  if (!productName) {
    if (amount <= 25) return 'zoom_trial';
    if (amount <= 50) return 'pcos';
    if (amount <= 100) return '6wk_gym';
    if (amount <= 160) return 'zoom_pack';
    return '12wk';
  }
  const lower = productName.toLowerCase();
  if (/pcos/.test(lower)) return 'pcos';
  if (/40\+|forty/.test(lower)) return '40plus';
  if (/12.?week|custom|flagship/.test(lower)) return '12wk';
  if (/zoom.*trial/.test(lower)) return 'zoom_trial';
  if (/zoom.*pack/.test(lower)) return 'zoom_pack';
  if (/home/.test(lower)) return '6wk_home';
  return '6wk_gym';
}
