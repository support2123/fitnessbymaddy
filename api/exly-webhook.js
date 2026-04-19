const { supabase } = require('./_lib/supabase');
const { sendTemplate, notifyMaddy, maskPhone } = require('./_lib/whatsapp');
const { cors, parseBody, programPrice } = require('./_lib/helpers');

function programDurationWeeks(program) {
  const durations = {
    '6wk_gym': 6, '6wk_home': 6, '12wk': 12,
    'pcos': 8, '40plus': 8, 'zoom_trial': 1, 'zoom_pack': 4,
  };
  return durations[program] || 6;
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = await parseBody(req);

    const webhookSecret = process.env.EXLY_WEBHOOK_SECRET;
    if (webhookSecret && body.secret !== webhookSecret) {
      return res.status(401).json({ error: 'Invalid webhook secret' });
    }

    const phone = body.phone || body.customer_phone || '';
    const email = body.email || body.customer_email || '';
    const name = body.name || body.customer_name || '';
    const checkoutId = body.checkout_id || body.order_id || '';
    const paidAmount = body.amount || body.paid_amount || 0;
    const programCode = body.program || body.product_code || '6wk_gym';

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (lead) {
      await supabase.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const durationWeeks = programDurationWeeks(programCode);
    const startsAt = new Date();
    const endsAt = new Date(startsAt.getTime() + durationWeeks * 7 * 24 * 60 * 60 * 1000);

    const { data: client, error } = await supabase.from('clients').insert({
      lead_id: lead?.id || null,
      phone,
      name,
      email,
      program: programCode,
      program_started_at: startsAt.toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: parseInt(paidAmount),
      checkout_id: checkoutId,
      folder_url: `clients/${lead?.id || 'unknown'}/`,
      status: 'active',
    }).select().single();

    if (error) throw error;

    await sendTemplate(phone, `onboard_${programCode}`, {
      name: name || 'there',
      templateParams: [name || 'there', `Week 1`],
    });

    if (programCode === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://fitnessbymaddy.com';

        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch (err) {
        console.error('Week 1 program generation failed:', err.message);
      }
    }

    return res.status(200).json({ ok: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
