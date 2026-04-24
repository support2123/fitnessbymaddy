const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { escalateToMaddy } = require('./_lib/escalation');
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

    const {
      event, phone, email, name, amount,
      checkout_id, product_name
    } = req.body;

    if (event === 'payment.failed') {
      await escalateToMaddy(
        `Payment failed for ${product_name || 'unknown program'}`,
        name || 'Unknown',
        phone || 'N/A'
      );
      return res.status(200).json({ ok: true, action: 'payment_failed_escalated' });
    }

    if (event !== 'payment.success' && event !== 'purchase.completed') {
      return res.status(200).json({ ok: true, skipped: true });
    }

    const db = getSupabase();
    const program = mapProductToProgram(product_name);

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const programDuration = getProgramDuration(program);
    const now = new Date();
    const endsAt = new Date(now.getTime() + programDuration * 7 * 24 * 60 * 60 * 1000);

    const { data: client } = await db.from('clients').insert({
      lead_id: lead?.id || null,
      phone,
      name: name || lead?.name || null,
      email: email || null,
      program,
      program_started_at: now.toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: amount ? parseFloat(amount) : null,
      checkout_id: checkout_id || null,
      status: 'active'
    }).select().single();

    const templateName = `onboard_${program}`;
    await sendWhatsApp(phone, templateName, {
      name: name || lead?.name || 'there',
      _isClient: true
    });

    if (email) {
      try {
        const { Resend } = require('resend');
        const resend = new Resend(process.env.RESEND_API_KEY);
        await resend.emails.send({
          from: 'Fitness by Maddy <support@fitnessbymaddy.com>',
          to: email,
          subject: `Welcome to ${getReadableProgramName(program)}!`,
          html: buildWelcomeEmail(name || 'there', program)
        });
      } catch (emailErr) {
        console.error('Welcome email failed:', emailErr.message);
      }
    }

    if (program === '12wk' && client) {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://fitnessbymaddy.com';

        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_id: client.id,
            week_no: 1
          })
        });
      } catch (err) {
        console.error('Week 1 program generation failed:', err.message);
      }
    }

    return res.status(200).json({ ok: true, action: 'client_onboarded', client_id: client?.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function mapProductToProgram(productName) {
  if (!productName) return '6wk_gym';
  const lower = productName.toLowerCase();
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40+') || lower.includes('40 plus') || lower.includes('forty')) return '40plus';
  if (lower.includes('12') || lower.includes('twelve') || lower.includes('flagship') || lower.includes('custom')) return '12wk';
  if (lower.includes('zoom') || lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('pack')) return 'zoom_pack';
  return '6wk_gym';
}

function getProgramDuration(program) {
  const durations = {
    '6wk_gym': 6, '6wk_home': 6, '12wk': 12,
    'pcos': 8, '40plus': 8, 'zoom_trial': 1, 'zoom_pack': 4
  };
  return durations[program] || 6;
}

function getReadableProgramName(program) {
  const names = {
    '6wk_gym': '6-Week Burn & Build (Gym)',
    '6wk_home': '6-Week Burn & Build (Home)',
    '12wk': '12-Week Flagship Program',
    'pcos': 'PCOS Warrior Program',
    '40plus': '40+ Strong Program',
    'zoom_trial': 'Zoom Trial Session',
    'zoom_pack': 'Zoom Pack'
  };
  return names[program] || program;
}

function buildWelcomeEmail(name, program) {
  const programName = getReadableProgramName(program);
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#FAF8F4;font-family:'Helvetica Neue',Arial,sans-serif;">
<div style="max-width:600px;margin:0 auto;background:#fff;">
  <div style="background:#2C2C2C;padding:40px 32px;text-align:center;">
    <h1 style="color:#B8965A;font-size:24px;margin:0;letter-spacing:2px;">FITNESS BY MADDY</h1>
  </div>
  <div style="padding:40px 32px;">
    <h2 style="color:#2C2C2C;font-size:28px;margin:0 0 16px;">Welcome, ${name}!</h2>
    <p style="color:#6B6B6B;font-size:16px;line-height:1.7;">
      You're officially enrolled in the <strong>${programName}</strong>. Your transformation journey starts now.
    </p>
    <div style="background:#FAF8F4;border-left:3px solid #B8965A;padding:20px;margin:24px 0;">
      <p style="color:#2C2C2C;font-size:14px;margin:0;"><strong>What happens next:</strong></p>
      <ul style="color:#6B6B6B;font-size:14px;line-height:1.8;margin:8px 0 0;padding-left:20px;">
        <li>Your personalised plan will be delivered via WhatsApp</li>
        <li>Weekly check-in forms will arrive every Sunday</li>
        <li>Reply to any WhatsApp message for support</li>
      </ul>
    </div>
    <p style="color:#6B6B6B;font-size:14px;">Let's make this count.</p>
    <p style="color:#2C2C2C;font-size:14px;font-weight:600;">— Team Maddy</p>
  </div>
  <div style="background:#2C2C2C;padding:20px 32px;text-align:center;">
    <p style="color:rgba(255,255,255,0.4);font-size:12px;margin:0;">Fitness by Maddy | fitnessbymaddy.com</p>
  </div>
</div>
</body>
</html>`;
}
