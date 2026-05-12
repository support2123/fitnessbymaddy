const { supabase } = require('./_lib/supabase');
const { sendWhatsApp, detectMarket } = require('./_lib/whatsapp');
const crypto = require('crypto');

const PROGRAM_MAP = {
  '6_week_shred': '6wk_gym',
  '6_week_home': '6wk_home',
  '12_week_custom': '12wk',
  'pcos_warrior': 'pcos',
  '40_plus_strong': '40plus',
  'zoom_trial': 'zoom_trial',
  'zoom_pack': 'zoom_pack',
};

const PROGRAM_DURATIONS = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 30,
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    if (process.env.EXLY_WEBHOOK_SECRET) {
      const sig = req.headers['x-exly-signature'];
      const expected = crypto
        .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (sig && sig !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const {
      customer_phone, customer_name, customer_email,
      product_name, amount, checkout_id, status: paymentStatus
    } = req.body;

    if (paymentStatus && paymentStatus !== 'completed') {
      if (paymentStatus === 'failed') {
        const { data: activeClient } = await supabase
          .from('clients')
          .select('*')
          .eq('phone', customer_phone)
          .eq('status', 'active')
          .limit(1);

        if (activeClient && activeClient.length > 0) {
          const { escalateToMaddy } = require('./_lib/escalation');
          await escalateToMaddy(
            'Payment failed for active client',
            `${customer_name} (${customer_phone}) - ${product_name}`
          );
        }
      }
      return res.status(200).json({ action: 'skipped', reason: paymentStatus });
    }

    const program = PROGRAM_MAP[product_name] || '12wk';
    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const programEnds = new Date();
    programEnds.setDate(programEnds.getDate() + durationDays);

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', customer_phone)
      .order('created_at', { ascending: false })
      .limit(1);

    let leadId = null;
    if (lead && lead.length > 0) {
      leadId = lead[0].id;
      await supabase
        .from('leads')
        .update({ status: 'converted' })
        .eq('id', leadId);
    }

    const folderPath = `clients/${checkout_id || crypto.randomUUID()}`;

    const { data: client, error } = await supabase
      .from('clients')
      .insert({
        lead_id: leadId,
        phone: customer_phone,
        name: customer_name,
        email: customer_email,
        program,
        program_started_at: new Date().toISOString(),
        program_ends_at: programEnds.toISOString(),
        paid_amount: amount ? parseInt(amount) : null,
        checkout_id,
        folder_url: folderPath,
        status: 'active'
      })
      .select()
      .single();

    if (error) throw error;

    const market = detectMarket(customer_phone);
    await sendWhatsApp(customer_phone, `onboard_${program}`, {
      name: customer_name || 'there',
      templateParams: [
        customer_name || 'there',
        `Day 1 starts now! Your ${program.replace('_', ' ')} program is live.`
      ]
    }, true);

    if (program === '12wk') {
      try {
        await fetch(`${process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : ''}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': process.env.INTERNAL_API_KEY
          },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (genErr) {
        console.error('Week 1 program gen failed:', genErr.message);
      }
    }

    return res.status(200).json({ ok: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
