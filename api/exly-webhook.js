const crypto = require('crypto');
const { getClient } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { detectMarket } = require('../lib/market');

const PROGRAM_DURATIONS = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 30,
};

function verifySignature(body, signature) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true;
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(JSON.stringify(body));
  return hmac.digest('hex') === signature;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const signature = req.headers['x-exly-signature'];
    if (!verifySignature(req.body, signature)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const {
      checkout_id,
      customer_phone,
      customer_name,
      customer_email,
      product_name,
      amount,
    } = req.body;

    if (!customer_phone) {
      return res.status(400).json({ error: 'customer_phone required' });
    }

    const db = getClient();

    const program = mapProductToProgram(product_name);
    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const programEnds = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000);

    const { data: lead } = await db
      .from('leads')
      .select('id')
      .eq('phone', customer_phone)
      .limit(1)
      .single();

    if (lead) {
      await db
        .from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const { data: client, error } = await db
      .from('clients')
      .insert({
        lead_id: lead?.id || null,
        phone: customer_phone,
        name: customer_name,
        email: customer_email,
        program,
        program_started_at: new Date().toISOString(),
        program_ends_at: programEnds.toISOString(),
        paid_amount: amount ? Math.round(amount * 100) : null,
        checkout_id,
        status: 'active',
      })
      .select('id')
      .single();

    if (error) {
      console.error('Client creation error:', error.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    const folderPath = `clients/${client.id}`;
    await db.storage.from('clients').upload(`${folderPath}/.keep`, new Uint8Array(0), {
      upsert: true,
    });
    await db
      .from('clients')
      .update({ folder_url: folderPath })
      .eq('id', client.id);

    const templateMap = {
      '6wk_gym': 'onboard_6wk',
      '6wk_home': 'onboard_6wk',
      '12wk': 'onboard_12wk',
      'pcos': 'onboard_pcos',
      '40plus': 'onboard_40plus',
      'zoom_trial': 'onboard_trial',
      'zoom_pack': 'onboard_zoom',
    };

    await sendTemplate(
      customer_phone,
      templateMap[program] || 'onboard_general',
      [customer_name || 'there']
    );

    if (program === '12wk') {
      try {
        const baseUrl = `https://${req.headers.host}`;
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch (genErr) {
        console.error('Week-1 generation trigger failed:', genErr.message);
      }
    }

    return res.status(200).json({ success: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function mapProductToProgram(productName) {
  if (!productName) return '6wk_gym';
  const lower = productName.toLowerCase();

  if (lower.includes('12') || lower.includes('flagship') || lower.includes('custom')) return '12wk';
  if (lower.includes('pcos') || lower.includes('warrior')) return 'pcos';
  if (lower.includes('40') || lower.includes('strong')) return '40plus';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('zoom') || lower.includes('pack')) return 'zoom_pack';
  return '6wk_gym';
}
