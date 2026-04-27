const { getSupabase } = require('../lib/supabase');
const { sendText, sendTemplate, notifyMaddy } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');
const crypto = require('crypto');

const PROGRAM_DURATION = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 30
};

const PROGRAM_FROM_CHECKOUT = {
  'shred-6wk': '6wk_gym',
  'shred-6wk-home': '6wk_home',
  'custom-12wk': '12wk',
  'pcos-warrior': 'pcos',
  'forty-plus': '40plus',
  'zoom-trial': 'zoom_trial',
  'zoom-pack': 'zoom_pack'
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    // Verify webhook signature if secret is configured
    const secret = process.env.EXLY_WEBHOOK_SECRET;
    if (secret && req.headers['x-webhook-signature']) {
      const signature = req.headers['x-webhook-signature'];
      const expected = crypto.createHmac('sha256', secret)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (signature !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const {
      phone, email, name, checkout_id, amount, product_id, product_name
    } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone required' });

    const sb = getSupabase();

    // Determine program from checkout
    const program = PROGRAM_FROM_CHECKOUT[product_id] ||
      PROGRAM_FROM_CHECKOUT[checkout_id] ||
      inferProgram(product_name) ||
      '12wk';

    // Find or create lead
    let { data: lead } = await sb.from('leads').select('*').eq('phone', phone).single();

    if (!lead) {
      const { data: newLead } = await sb.from('leads').insert({
        phone,
        name: name || null,
        source: 'exly',
        status: 'converted',
        market: detectMarket(phone)
      }).select().single();
      lead = newLead;
    } else {
      await sb.from('leads').update({ status: 'converted', name: name || lead.name }).eq('id', lead.id);
    }

    // Calculate program dates
    const startDate = new Date();
    const durationDays = PROGRAM_DURATION[program] || 42;
    const endDate = new Date(startDate.getTime() + durationDays * 24 * 60 * 60 * 1000);

    // Create client
    const { data: client } = await sb.from('clients').insert({
      lead_id: lead.id,
      phone,
      name: name || lead.name,
      email: email || null,
      program,
      program_started_at: startDate.toISOString(),
      program_ends_at: endDate.toISOString(),
      paid_amount: amount ? parseInt(amount, 10) : 0,
      checkout_id: checkout_id || product_id,
      status: 'active'
    }).select().single();

    // Create storage folder
    const folderPath = `clients/${client.id}/.keep`;
    await sb.storage.from('clients').upload(folderPath, Buffer.from(''), {
      contentType: 'text/plain',
      upsert: true
    });

    await sb.from('clients').update({
      folder_url: `${process.env.SUPABASE_URL}/storage/v1/object/clients/${client.id}/`
    }).eq('id', client.id);

    // Send welcome message
    const market = detectMarket(phone);
    if (isHinglish(market)) {
      await sendText(phone,
        `Welcome to the family! 🎉\n\n` +
        `Tumhara *${formatProgram(program)}* program shuru ho gaya hai.\n\n` +
        `📅 Start: ${startDate.toLocaleDateString('en-IN')}\n` +
        `📅 End: ${endDate.toLocaleDateString('en-IN')}\n\n` +
        `Pehla check-in Day 7 ko aayega. Tab tak — let's go! 💪`
      );
    } else {
      await sendText(phone,
        `Welcome to the family! 🎉\n\n` +
        `Your *${formatProgram(program)}* program has started.\n\n` +
        `📅 Start: ${startDate.toLocaleDateString('en-GB')}\n` +
        `📅 End: ${endDate.toLocaleDateString('en-GB')}\n\n` +
        `Your first check-in will be on Day 7. Until then — let's go! 💪`
      );
    }

    // For 12-week clients, trigger immediate Week 1 program generation
    if (program === '12wk') {
      const baseUrl = `https://${req.headers.host}`;
      fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: client.id, week_no: 1 })
      }).catch(() => {});
    }

    return res.json({ success: true, client_id: client.id, program });

  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function formatProgram(code) {
  const map = {
    '6wk_gym': '6-Week Burn & Build (Gym)',
    '6wk_home': '6-Week Burn & Build (Home)',
    '12wk': '12-Week Custom Training',
    'pcos': 'PCOS Warrior',
    '40plus': '40+ Strong',
    'zoom_trial': 'Zoom Trial',
    'zoom_pack': 'Zoom Pack'
  };
  return map[code] || code;
}

function inferProgram(productName) {
  if (!productName) return null;
  const lower = productName.toLowerCase();
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40')) return '40plus';
  if (lower.includes('12') || lower.includes('custom')) return '12wk';
  if (lower.includes('trial') || lower.includes('zoom')) return 'zoom_trial';
  if (lower.includes('shred') || lower.includes('6 week')) return '6wk_gym';
  return null;
}
