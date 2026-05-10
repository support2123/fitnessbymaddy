const crypto = require('crypto');
const supabase = require('../lib/supabase');
const { sendTemplate, notifyMaddy } = require('../lib/whatsapp');
const { isHinglish, detectMarket } = require('../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const signature = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'];
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
      product_name, amount, checkout_id, order_id
    } = req.body;

    if (!customer_phone) {
      return res.status(400).json({ error: 'Missing customer_phone' });
    }

    const phone = customer_phone.startsWith('+') ? customer_phone : '+' + customer_phone;
    const program = mapProductToProgram(product_name);
    const market = detectMarket(phone);

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (lead) {
      await supabase
        .from('leads')
        .update({ status: 'converted', last_msg_at: new Date().toISOString() })
        .eq('id', lead.id);
    }

    const programDuration = getProgramDuration(program);
    const now = new Date();
    const endsAt = new Date(now.getTime() + programDuration * 7 * 24 * 60 * 60 * 1000);

    const { data: client, error: clientError } = await supabase
      .from('clients')
      .insert({
        lead_id: lead?.id || null,
        phone,
        name: customer_name || lead?.name || null,
        email: customer_email || null,
        program,
        program_started_at: now.toISOString(),
        program_ends_at: endsAt.toISOString(),
        paid_amount: Math.round((amount || 0) * 100),
        checkout_id: checkout_id || order_id || null,
        status: 'active'
      })
      .select()
      .single();

    if (clientError) {
      console.error('Client insert error:', clientError.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    const folderPath = `clients/${client.id}`;
    await supabase.storage.from('clients').upload(
      `${folderPath}/.keep`, new Uint8Array(0), { upsert: true }
    );
    await supabase
      .from('clients')
      .update({ folder_url: folderPath })
      .eq('id', client.id);

    const templateName = `onboard_${program}`;
    if (isHinglish(market)) {
      await sendTemplate(phone, templateName + '_hi', [customer_name || 'Champion']);
    } else {
      await sendTemplate(phone, templateName + '_en', [customer_name || 'Champion']);
    }

    if (program === '12wk') {
      try {
        await fetch(`https://www.fitnessbymaddy.com/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (e) {
        console.error('Week-1 generation trigger failed:', e.message);
      }
    }

    return res.status(200).json({ status: 'converted', client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    await notifyMaddy('Payment webhook error', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function mapProductToProgram(productName) {
  if (!productName) return '6wk_gym';
  const lower = productName.toLowerCase();
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40+') || lower.includes('40 plus') || lower.includes('40plus')) return '40plus';
  if (lower.includes('12') || lower.includes('twelve') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('zoom') && lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('zoom') && lower.includes('pack')) return 'zoom_pack';
  if (lower.includes('home')) return '6wk_home';
  return '6wk_gym';
}

function getProgramDuration(program) {
  const durations = {
    '6wk_gym': 6, '6wk_home': 6,
    '12wk': 12,
    'pcos': 6, '40plus': 6,
    'zoom_trial': 1, 'zoom_pack': 4
  };
  return durations[program] || 6;
}
