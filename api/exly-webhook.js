const { supabase } = require('./lib/supabase');
const { sendRateLimitedToClient, notifyMaddy } = require('./lib/whatsapp');
const crypto = require('crypto');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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

  try {
    const { event, data } = req.body;

    if (event !== 'payment.success' && event !== 'order.completed') {
      return res.status(200).json({ action: 'ignored', event });
    }

    const phone = data.phone || data.customer_phone;
    const email = data.email || data.customer_email;
    const name = data.name || data.customer_name;
    const amount = data.amount || data.total;
    const checkoutId = data.checkout_id || data.order_id;

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone in payment data' });
    }

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    const program = lead?.program_interest || detectProgramFromAmount(amount);
    const programDuration = getProgramDuration(program);

    const { data: client, error } = await supabase
      .from('clients')
      .insert({
        lead_id: lead?.id || null,
        phone,
        name: name || lead?.name,
        email,
        program,
        program_started_at: new Date().toISOString(),
        program_ends_at: new Date(Date.now() + programDuration).toISOString(),
        paid_amount: amount,
        checkout_id: checkoutId,
        folder_url: null,
        status: 'active'
      })
      .select()
      .single();

    if (error) throw error;

    if (lead) {
      await supabase
        .from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const folderPath = `clients/${client.id}`;
    await supabase.storage
      .from('programs')
      .upload(`${folderPath}/.keep`, new Uint8Array(0), {
        contentType: 'text/plain',
        upsert: true
      });

    await supabase
      .from('clients')
      .update({ folder_url: folderPath })
      .eq('id', client.id);

    const market = lead?.market || 'IN';
    const welcomeMsg = market === 'IN'
      ? `🎉 Welcome to the ${getProgramName(program)} family, ${name || 'champion'}!\n\nAapka program Day 1 se start hoga. Pehla check-in form Day 7 ko aayega.\n\nLet's crush this! 💪`
      : `🎉 Welcome to ${getProgramName(program)}, ${name || 'champion'}!\n\nYour program starts Day 1. First check-in form arrives on Day 7.\n\nLet's do this! 💪`;

    await sendRateLimitedToClient({
      phone,
      templateName: `onboard_${program}`,
      body: welcomeMsg,
      params: { name, templateParams: [name || 'there', getProgramName(program)] }
    });

    return res.status(200).json({ success: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    await notifyMaddy('Payment webhook error', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function detectProgramFromAmount(amount) {
  if (amount <= 20) return 'zoom_trial';
  if (amount <= 35) return '6wk_gym';
  if (amount <= 45) return 'pcos';
  if (amount <= 50) return '40plus';
  if (amount >= 200) return '12wk';
  return '6wk_gym';
}

function getProgramDuration(program) {
  const durations = {
    'zoom_trial': 7 * 24 * 60 * 60 * 1000,
    '6wk_gym': 42 * 24 * 60 * 60 * 1000,
    '6wk_home': 42 * 24 * 60 * 60 * 1000,
    'pcos': 42 * 24 * 60 * 60 * 1000,
    '40plus': 42 * 24 * 60 * 60 * 1000,
    '12wk': 84 * 24 * 60 * 60 * 1000,
    'zoom_pack': 30 * 24 * 60 * 60 * 1000
  };
  return durations[program] || 42 * 24 * 60 * 60 * 1000;
}

function getProgramName(program) {
  const names = {
    '6wk_gym': '6-Week Burn & Build (Gym)',
    '6wk_home': '6-Week Burn & Build (Home)',
    'pcos': 'PCOS Warrior',
    '40plus': '40+ Strong',
    '12wk': '12-Week Flagship',
    'zoom_trial': 'Zoom Trial',
    'zoom_pack': 'Zoom Pack'
  };
  return names[program] || program;
}
