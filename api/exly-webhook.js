const supabase = require('../lib/supabase');
const { sendTemplate, notifyMaddy, maskPhone } = require('../lib/whatsapp');
const { Resend } = require('resend');

const PROGRAM_DURATIONS = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 30
};

const CHECKOUT_TO_PROGRAM = {
  '6wk-burn-build': '6wk_gym',
  'pcos-warrior': 'pcos',
  '40plus-strong': '40plus',
  '12wk-flagship': '12wk',
  'zoom-trial': 'zoom_trial'
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const secret = req.headers['x-exly-secret'] || req.headers['x-webhook-secret'];
    if (process.env.EXLY_WEBHOOK_SECRET && secret !== process.env.EXLY_WEBHOOK_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { phone, name, email, checkout_id, product_id, amount } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone' });
    }

    const normalizedPhone = phone.startsWith('+') ? phone : `+${phone}`;
    const program = CHECKOUT_TO_PROGRAM[product_id] || detectProgramFromAmount(amount);

    if (!program) {
      await notifyMaddy('Unknown Purchase', `Phone: ${maskPhone(normalizedPhone)}\nAmount: ${amount}\nProduct: ${product_id}`);
      return res.status(200).json({ action: 'flagged_unknown_product' });
    }

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', normalizedPhone)
      .single();

    if (lead) {
      await supabase
        .from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + (PROGRAM_DURATIONS[program] || 42) * 24 * 60 * 60 * 1000);

    const { data: client, error } = await supabase
      .from('clients')
      .insert({
        lead_id: lead?.id || null,
        phone: normalizedPhone,
        name: name || lead?.name || null,
        email: email || null,
        program,
        program_started_at: startDate.toISOString(),
        program_ends_at: endDate.toISOString(),
        paid_amount: amount ? parseInt(amount) : null,
        checkout_id: checkout_id || null,
        folder_url: null,
        status: 'active'
      })
      .select()
      .single();

    if (error) throw error;

    const folderPath = `clients/${client.id}/`;
    await supabase.storage
      .from('client-files')
      .upload(`${folderPath}.keep`, Buffer.from(''), { contentType: 'text/plain' });

    await supabase
      .from('clients')
      .update({ folder_url: folderPath })
      .eq('id', client.id);

    await sendTemplate(normalizedPhone, `onboard_${program}`, {
      name: client.name || 'there',
      templateParams: [
        client.name || 'there',
        `Day 7 (${new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000).toLocaleDateString('en-IN')})`
      ]
    });

    if (email) {
      try {
        const resend = new Resend(process.env.RESEND_API_KEY);
        await resend.emails.send({
          from: 'Fitness by Maddy <support@fitnessbymaddy.com>',
          to: email,
          subject: `Welcome to ${program === '12wk' ? '12-Week Flagship' : 'Fitness by Maddy'}! 🎉`,
          html: buildWelcomeEmail(client.name || 'there', program)
        });
      } catch (e) {
        console.error('Welcome email failed:', e.message);
      }
    }

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
      } catch (e) {
        console.error('Week-1 program generation failed:', e.message);
      }
    }

    return res.status(200).json({ success: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function detectProgramFromAmount(amount) {
  const amt = parseInt(amount);
  if (!amt) return null;
  if (amt <= 25) return 'zoom_trial';
  if (amt <= 50) return 'pcos';
  if (amt <= 55) return '40plus';
  if (amt <= 100) return '6wk_gym';
  if (amt <= 250) return '12wk';
  return null;
}

function buildWelcomeEmail(name, program) {
  return `
    <div style="font-family:'DM Sans',Arial,sans-serif;max-width:600px;margin:0 auto;background:#FAF8F4;padding:40px;">
      <div style="text-align:center;margin-bottom:32px;">
        <h1 style="font-family:Georgia,serif;font-size:28px;color:#2C2C2C;margin:0;">Fitness by Maddy</h1>
      </div>
      <div style="background:white;padding:32px;border-radius:4px;border:1px solid #E8E3DC;">
        <h2 style="font-family:Georgia,serif;font-size:24px;color:#2C2C2C;margin:0 0 16px;">Welcome, ${name}!</h2>
        <p style="color:#6B6B6B;line-height:1.8;font-size:15px;">
          Your journey starts now. We're thrilled to have you on board.
        </p>
        <p style="color:#6B6B6B;line-height:1.8;font-size:15px;">
          Here's what happens next:
        </p>
        <ul style="color:#6B6B6B;line-height:2;font-size:15px;padding-left:20px;">
          <li>You'll receive your first check-in form on Day 7</li>
          <li>Fill it out honestly — it helps us personalize your plan</li>
          <li>Reach out on WhatsApp anytime you have questions</li>
        </ul>
        <div style="margin-top:24px;padding:16px;background:#FAF8F4;border-left:3px solid #B8965A;">
          <p style="color:#2C2C2C;font-size:14px;margin:0;"><strong>Pro tip:</strong> Consistency beats intensity. Show up every day, even on the hard days.</p>
        </div>
      </div>
      <p style="text-align:center;color:#C8B89A;font-size:12px;margin-top:24px;">
        © ${new Date().getFullYear()} Fitness by Maddy · support@fitnessbymaddy.com
      </p>
    </div>
  `;
}
