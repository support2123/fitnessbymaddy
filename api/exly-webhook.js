const { supabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { PROGRAMS } = require('../lib/constants');
const crypto = require('crypto');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const secret = process.env.EXLY_WEBHOOK_SECRET;
    if (secret) {
      const sig = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'] || '';
      const expected = crypto.createHmac('sha256', secret).update(JSON.stringify(req.body)).digest('hex');
      if (sig && sig !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const {
      checkout_id, phone, name, email, amount,
      product_name, status,
    } = req.body;

    if (status !== 'completed' && status !== 'paid' && status !== 'success') {
      return res.status(200).json({ action: 'ignored_non_payment' });
    }

    const normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone) {
      return res.status(400).json({ error: 'Missing phone' });
    }

    const program = detectProgram(product_name, amount);
    const programInfo = PROGRAMS[program];
    const weeksCount = programInfo ? programInfo.weeks : 6;
    const endsAt = new Date();
    endsAt.setDate(endsAt.getDate() + weeksCount * 7);

    const { data: lead } = await supabase
      .from('leads')
      .select('id')
      .eq('phone', normalizedPhone)
      .maybeSingle();

    if (lead) {
      await supabase.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const folderPath = `clients/${crypto.randomUUID()}`;

    const { data: client, error } = await supabase.from('clients').insert({
      lead_id: lead?.id,
      phone: normalizedPhone,
      name: name || null,
      email: email || null,
      program,
      program_started_at: new Date().toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: amount ? Math.round(parseFloat(amount) * 100) : null,
      checkout_id: checkout_id || null,
      folder_url: folderPath,
      status: 'active',
    }).select().single();

    if (error) {
      console.error('[Exly] Client insert error:', error.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    await sendTemplate(normalizedPhone, `onboard_${program}`, [name || 'there']);

    if (program === '12wk') {
      try {
        const baseUrl = `https://${req.headers.host}`;
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch (e) {
        console.error('[Exly] Week 1 program generation failed:', e.message);
      }
    }

    if (email) {
      try {
        const { Resend } = require('resend');
        const resend = new Resend(process.env.RESEND_API_KEY);
        await resend.emails.send({
          from: 'Fitness by Maddy <support@fitnessbymaddy.com>',
          to: email,
          subject: `Welcome to ${programInfo?.name || 'Fitness by Maddy'}!`,
          html: `<p>Hi ${name || 'there'},</p>
<p>Welcome to <strong>${programInfo?.name || 'your fitness program'}</strong>! We're excited to have you on board.</p>
<p>Your program starts now. You'll receive your first check-in form in 7 days via WhatsApp.</p>
<p>If you have any questions, reply to this email or message us on WhatsApp.</p>
<p>Let's crush it!<br>Team Fitness by Maddy</p>`,
        });
      } catch (e) {
        console.error('[Exly] Welcome email failed:', e.message);
      }
    }

    return res.status(200).json({ ok: true, client_id: client.id });
  } catch (err) {
    console.error('[Exly Webhook Error]', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function detectProgram(productName, amount) {
  const name = (productName || '').toLowerCase();
  if (name.includes('pcos')) return 'pcos';
  if (name.includes('40+') || name.includes('40 plus')) return '40plus';
  if (name.includes('12') || name.includes('custom') || name.includes('flagship')) return '12wk';
  if (name.includes('zoom') && name.includes('trial')) return 'zoom_trial';
  if (name.includes('zoom')) return 'zoom_pack';
  if (name.includes('home')) return '6wk_home';

  const cents = amount ? Math.round(parseFloat(amount) * 100) : 0;
  if (cents >= 15000) return '12wk';
  if (cents >= 4000) return 'pcos';
  if (cents >= 2000) return 'zoom_trial';
  return '6wk_gym';
}

function normalizePhone(raw) {
  if (!raw) return null;
  let phone = raw.replace(/[\s\-\(\)]/g, '');
  if (!phone.startsWith('+')) phone = '+' + phone;
  return phone;
}
