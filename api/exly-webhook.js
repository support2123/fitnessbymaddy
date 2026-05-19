const { supabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { getProgramDetails } = require('./_lib/programs');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const secret = req.headers['x-webhook-secret'] || req.headers['x-exly-secret'];
    if (process.env.EXLY_WEBHOOK_SECRET && secret !== process.env.EXLY_WEBHOOK_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const {
      customer_name, customer_email, customer_phone,
      product_name, amount, checkout_id, lead_id
    } = req.body;

    if (!customer_phone) {
      return res.status(400).json({ error: 'Missing customer phone' });
    }

    const phone = customer_phone.replace(/[\s\-\(\)\+]/g, '').replace(/^0+/, '');
    const program = detectProgram(product_name, amount);
    const details = getProgramDetails(program);
    const weeks = details ? details.weeks : 6;
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + weeks * 7);

    let resolvedLeadId = lead_id;
    if (!resolvedLeadId) {
      const { data: lead } = await supabase
        .from('leads')
        .select('id')
        .eq('phone', phone)
        .maybeSingle();
      resolvedLeadId = lead?.id;
    }

    if (resolvedLeadId) {
      await supabase.from('leads').update({ status: 'converted' }).eq('id', resolvedLeadId);
    }

    const folderPath = `clients/${phone}`;

    const { data: client, error: clientError } = await supabase
      .from('clients')
      .insert({
        lead_id: resolvedLeadId || null,
        phone,
        name: customer_name,
        email: customer_email,
        program,
        program_started_at: new Date().toISOString(),
        program_ends_at: endDate.toISOString(),
        paid_amount: amount ? parseInt(amount) : null,
        checkout_id: checkout_id || null,
        folder_url: folderPath,
        status: 'active'
      })
      .select()
      .single();

    if (clientError) {
      console.error('Client insert error:', clientError.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    const templateName = `onboard_${program}`;
    await sendWhatsApp(phone, templateName, [
      customer_name || 'there',
      details ? details.name : program,
      'Welcome aboard! Your program journey starts now.'
    ]);

    if (customer_email) {
      try {
        const { Resend } = require('resend');
        const resend = new Resend(process.env.RESEND_API_KEY);
        await resend.emails.send({
          from: 'Fitness by Maddy <support@fitnessbymaddy.com>',
          to: customer_email,
          subject: `Welcome to ${details ? details.name : 'Fitness by Maddy'}!`,
          html: buildWelcomeEmail(customer_name, details)
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
        console.error('Week 1 program generation failed:', e.message);
      }
    }

    return res.json({ success: true, client_id: client.id, program });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function detectProgram(productName, amount) {
  if (!productName) return '6wk_gym';
  const lower = productName.toLowerCase();
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40+') || lower.includes('40 plus')) return '40plus';
  if (lower.includes('12') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('zoom') && lower.includes('pack')) return 'zoom_pack';
  if (lower.includes('home')) return '6wk_home';
  return '6wk_gym';
}

function buildWelcomeEmail(name, details) {
  return `
    <div style="font-family:'DM Sans',sans-serif;max-width:600px;margin:0 auto;background:#FAF8F4;padding:40px;">
      <h1 style="font-family:'Cormorant Garamond',serif;color:#2C2C2C;font-size:32px;font-weight:300;">
        Welcome to Fitness by Maddy
      </h1>
      <p style="color:#6B6B6B;line-height:1.7;">
        Hi ${name || 'there'},<br><br>
        Thank you for joining <strong>${details ? details.name : 'our program'}</strong>!
        Your transformation journey starts now.
      </p>
      <p style="color:#6B6B6B;line-height:1.7;">
        Here is what happens next:
      </p>
      <ul style="color:#6B6B6B;line-height:2;">
        <li>You will receive your program details on WhatsApp</li>
        <li>Weekly check-in forms will be sent every Sunday</li>
        <li>If you have any questions, reply to this email or message us on WhatsApp</li>
      </ul>
      <div style="margin-top:32px;padding-top:24px;border-top:1px solid #E8E3DC;">
        <p style="color:#B8965A;font-size:12px;letter-spacing:2px;text-transform:uppercase;">
          Fitness by Maddy
        </p>
        <p style="color:#6B6B6B;font-size:12px;">support@fitnessbymaddy.com</p>
      </div>
    </div>`;
}
