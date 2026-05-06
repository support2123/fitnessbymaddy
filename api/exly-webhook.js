const { supabase } = require('../lib/supabase');
const { sendTemplate, notifyMaddy } = require('../lib/whatsapp');
const { corsHeaders, maskPhone, verifyExlyWebhook, programDuration } = require('../lib/utils');

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const signature = req.headers['x-exly-signature'];
    if (process.env.EXLY_WEBHOOK_SECRET && !verifyExlyWebhook(req.body, signature)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const {
      customer_phone, customer_name, customer_email,
      product_name, amount, checkout_id, status
    } = req.body;

    if (status !== 'completed' && status !== 'paid') {
      if (status === 'failed') {
        await notifyMaddy(
          'Payment failed',
          `Phone: ${maskPhone(customer_phone)}\nProduct: ${product_name}\nAmount: $${amount}`
        );
      }
      return res.status(200).json({ action: 'ignored', status });
    }

    const phone = customer_phone;
    const programMap = {
      '6 week shred': '6wk_gym',
      '6 week home': '6wk_home',
      '12 week': '12wk',
      'pcos': 'pcos',
      '40+': '40plus',
      'zoom trial': 'zoom_trial',
      'zoom pack': 'zoom_pack'
    };

    let program = null;
    const productLower = (product_name || '').toLowerCase();
    for (const [key, val] of Object.entries(programMap)) {
      if (productLower.includes(key)) { program = val; break; }
    }
    program = program || '6wk_gym';

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (lead) {
      await supabase.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const now = new Date();
    const endDate = new Date(now.getTime() + programDuration(program) * 86400000);

    const { data: client, error } = await supabase.from('clients').insert({
      lead_id: lead?.id || null,
      phone,
      name: customer_name,
      email: customer_email,
      program,
      program_started_at: now.toISOString(),
      program_ends_at: endDate.toISOString(),
      paid_amount: parseInt(amount) || 0,
      checkout_id,
      folder_url: `/clients/${phone}/`,
      status: 'active'
    }).select().single();

    if (error) throw error;

    await sendTemplate(phone, `onboard_${program}`, [
      customer_name || 'there'
    ]);

    if (program === '12wk') {
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
        console.error('Failed to trigger Week 1 generation:', e.message);
      }
    }

    console.log(`New client: ${maskPhone(phone)}, program: ${program}`);
    return res.status(200).json({ ok: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
