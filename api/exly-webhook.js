const crypto = require('crypto');
const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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
      customer_phone, customer_name, customer_email,
      product_name, amount, checkout_id,
    } = req.body;

    if (!customer_phone) return res.status(400).json({ error: 'No phone' });

    const supabase = getSupabase();

    const program = mapExlyProduct(product_name);

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', customer_phone)
      .single();

    if (lead) {
      await supabase.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const programWeeks = { '6wk_gym': 6, '6wk_home': 6, '12wk': 12, 'pcos': 6, '40plus': 8, 'zoom_trial': 1, 'zoom_pack': 8 };
    const weeks = programWeeks[program] || 6;
    const endsAt = new Date(Date.now() + weeks * 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: client, error } = await supabase.from('clients').insert({
      lead_id: lead?.id,
      phone: customer_phone,
      name: customer_name,
      email: customer_email,
      program,
      program_ends_at: endsAt,
      paid_amount: amount ? parseInt(amount) : null,
      checkout_id,
      folder_url: `/clients/${lead?.id || 'unknown'}/`,
      status: 'active',
    }).select().single();

    if (error) throw error;

    const folderPath = `clients/${client.id}/`;
    await supabase.storage.from('clients').upload(
      `${folderPath}.keep`,
      new Uint8Array(0),
      { contentType: 'text/plain', upsert: true }
    );

    await supabase.from('clients').update({ folder_url: folderPath }).eq('id', client.id);

    const market = lead?.market || detectMarket(customer_phone);
    const hinglish = isHinglish(market);

    const welcomeMsg = hinglish
      ? `Welcome to the ${getReadableProgramName(program)}! 🎉 Tera journey shuru ho gaya. Week 1 ka plan aa raha hai. Intake form fill kar dena agar nahi kiya.`
      : `Welcome to the ${getReadableProgramName(program)}! 🎉 Your journey starts now. Week 1 plan is on its way. Please fill the intake form if you haven't already.`;

    await sendWhatsApp(customer_phone, `onboard_${program}`, [
      customer_name || 'there',
      welcomeMsg,
    ]);

    if (program === '12wk') {
      const origin = req.headers['x-forwarded-proto'] === 'https'
        ? `https://${req.headers['x-forwarded-host'] || req.headers.host}`
        : `http://${req.headers.host}`;

      fetch(`${origin}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: client.id, week_no: 1 }),
      }).catch(() => {});
    }

    if (customer_email && process.env.RESEND_API_KEY) {
      await sendWelcomeEmail(customer_email, customer_name, program);
    }

    return res.status(200).json({ ok: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function mapExlyProduct(productName) {
  if (!productName) return '6wk_gym';
  const lower = productName.toLowerCase();
  if (lower.includes('12') || lower.includes('flagship') || lower.includes('custom')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40') || lower.includes('strong')) return '40plus';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('zoom') || lower.includes('pack')) return 'zoom_pack';
  return '6wk_gym';
}

function getReadableProgramName(program) {
  const names = {
    '6wk_gym': '6-Week Burn & Build',
    '6wk_home': '6-Week Home Shred',
    '12wk': '12-Week Flagship Program',
    'pcos': 'PCOS Warrior Program',
    '40plus': '40+ Strong Program',
    'zoom_trial': 'Zoom Trial Session',
    'zoom_pack': 'Zoom Sessions Pack',
  };
  return names[program] || program;
}

async function sendWelcomeEmail(email, name, program) {
  try {
    const { Resend } = require('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);

    await resend.emails.send({
      from: 'Fitness by Maddy <support@fitnessbymaddy.com>',
      to: email,
      subject: `Welcome to ${getReadableProgramName(program)}! 🎉`,
      html: `
        <div style="font-family: 'DM Sans', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #FAF8F4; padding: 40px;">
          <h1 style="font-family: Georgia, serif; color: #2C2C2C; font-weight: 300; font-size: 28px;">
            Welcome, ${name || 'there'}!
          </h1>
          <p style="color: #6B6B6B; line-height: 1.8; font-size: 15px;">
            You're officially enrolled in the <strong style="color: #B8965A;">${getReadableProgramName(program)}</strong>.
          </p>
          <p style="color: #6B6B6B; line-height: 1.8; font-size: 15px;">
            Here's what happens next:
          </p>
          <ul style="color: #6B6B6B; line-height: 2; font-size: 15px;">
            <li>Your Week 1 program will be sent via WhatsApp</li>
            <li>Weekly check-in forms will arrive every Sunday</li>
            <li>Any questions? Just reply on WhatsApp</li>
          </ul>
          <p style="color: #B8965A; font-weight: 500; margin-top: 30px;">
            Let's do this! 💪
          </p>
          <p style="color: #6B6B6B; font-size: 13px; margin-top: 40px; border-top: 1px solid #E8E3DC; padding-top: 20px;">
            © Fitness by Maddy | support@fitnessbymaddy.com
          </p>
        </div>
      `,
    });
  } catch (e) {
    console.error('Email send error:', e.message);
  }
}
