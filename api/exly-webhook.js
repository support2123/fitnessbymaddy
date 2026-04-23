const { supabase } = require('./lib/supabase');
const { sendTemplate, notifyMaddy, maskPhone } = require('./lib/whatsapp');
const { programWeeks, corsHeaders, json, parseBody } = require('./lib/helpers');
const { Resend } = require('resend');

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return json(res, 200, { ok: true });
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  try {
    const body = await parseBody(req);

    const secret = req.headers['x-webhook-secret'] || body.webhook_secret;
    if (process.env.EXLY_WEBHOOK_SECRET && secret !== process.env.EXLY_WEBHOOK_SECRET) {
      return json(res, 401, { error: 'Invalid webhook secret' });
    }

    const phone = (body.phone || body.customer_phone || '').replace(/[^0-9]/g, '');
    const email = body.email || body.customer_email || '';
    const name = body.name || body.customer_name || '';
    const program = body.program || body.product_name || '';
    const amount = body.amount || body.paid_amount || 0;
    const checkoutId = body.checkout_id || body.order_id || '';

    if (!phone) return json(res, 400, { error: 'Missing phone' });

    const programCode = mapExlyProgram(program);

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    let leadId = lead?.id;

    if (lead) {
      await supabase
        .from('leads')
        .update({ status: 'converted', program_interest: programCode })
        .eq('id', lead.id);
    } else {
      const { data: newLead } = await supabase
        .from('leads')
        .insert({
          phone, name, source: 'exly', status: 'converted',
          program_interest: programCode
        })
        .select()
        .single();
      leadId = newLead?.id;
    }

    const weeks = programWeeks(programCode);
    const startDate = new Date();
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + weeks * 7);

    const folderPath = `clients/${leadId}`;

    const { data: client, error: clientErr } = await supabase
      .from('clients')
      .insert({
        lead_id: leadId,
        phone,
        name: name || lead?.name || null,
        email,
        program: programCode,
        program_started_at: startDate.toISOString(),
        program_ends_at: endDate.toISOString(),
        paid_amount: parseInt(amount),
        checkout_id: checkoutId,
        folder_url: folderPath,
        status: 'active'
      })
      .select()
      .single();

    if (clientErr) {
      console.error('Client creation error:', clientErr.message);
      return json(res, 500, { error: 'Failed to create client' });
    }

    await sendTemplate(phone, `onboard_${programCode}`, [
      name || 'there',
      `Week 1 starts now!`
    ]);

    if (email && process.env.RESEND_API_KEY) {
      const resend = new Resend(process.env.RESEND_API_KEY);
      await resend.emails.send({
        from: 'Fitness by Maddy <support@fitnessbymaddy.com>',
        to: email,
        subject: `Welcome to Fitness by Maddy! Your ${programCode} journey starts now`,
        html: `
          <h2>Welcome, ${name || 'there'}!</h2>
          <p>Your program has been activated. Here's what happens next:</p>
          <ul>
            <li>You'll receive your first check-in form on Day 7</li>
            <li>Follow your plan consistently for best results</li>
            <li>Reach out on WhatsApp if you have any questions</li>
          </ul>
          <p>Let's crush this together!</p>
          <p>— Team Maddy</p>
        `
      });
    }

    if (programCode === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://fitnessbymaddy.com';
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (e) {
        console.error('Week-1 program generation failed:', e.message);
      }
    }

    return json(res, 200, { success: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    await notifyMaddy('Payment webhook error', `Error: ${err.message}`).catch(() => {});
    return json(res, 500, { error: 'Internal server error' });
  }
};

function mapExlyProgram(name) {
  if (!name) return '6wk_gym';
  const lower = name.toLowerCase();
  if (lower.includes('12') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40') || lower.includes('strong')) return '40plus';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('trial') || lower.includes('zoom')) return 'zoom_trial';
  if (lower.includes('pack')) return 'zoom_pack';
  return '6wk_gym';
}
