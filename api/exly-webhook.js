const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { escalateToMaddy } = require('../lib/escalation');
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

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // Verify webhook signature if secret is set
    if (process.env.EXLY_WEBHOOK_SECRET) {
      const signature = req.headers['x-exly-signature'];
      const expected = crypto
        .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (signature !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const { event, data } = req.body;

    if (event !== 'purchase.completed' && event !== 'payment.success') {
      return res.status(200).json({ action: 'ignored', event });
    }

    const phone = data.phone || data.customer_phone;
    const email = data.email || data.customer_email;
    const name = data.name || data.customer_name;
    const program = mapExlyProduct(data.product_id || data.product_name);
    const paidAmount = data.amount || data.paid_amount;
    const checkoutId = data.checkout_id || data.order_id;

    if (!phone) {
      return res.status(400).json({ error: 'Missing customer phone' });
    }

    const db = getSupabase();

    // Find or create lead
    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    const leadId = lead?.id || null;

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const now = new Date();
    const durationDays = PROGRAM_DURATION[program] || 42;
    const endsAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);
    const clientId = crypto.randomUUID();
    const folderPath = `clients/${clientId}`;

    const { data: client, error } = await db.from('clients').insert({
      id: clientId,
      lead_id: leadId,
      phone,
      name,
      email,
      program,
      program_started_at: now.toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: paidAmount,
      checkout_id: checkoutId,
      folder_url: folderPath,
      status: 'active'
    }).select().single();

    if (error) throw error;

    // Create storage folder
    try {
      await db.storage.from('clients').upload(`${clientId}/.keep`, new Uint8Array(0), {
        contentType: 'application/octet-stream',
        upsert: true
      });
    } catch (storageErr) {
      console.error('Storage folder creation:', storageErr.message);
    }

    // Send onboarding WhatsApp
    const onboardMsg = getOnboardMessage(program, name);
    await sendWhatsApp({
      phone,
      templateName: `onboard_${program}`,
      body: onboardMsg,
      params: [name || 'there']
    });

    // For 12-week program, trigger immediate Week 1 generation
    if (program === '12wk') {
      try {
        const baseUrl = `https://${req.headers.host}`;
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-internal-key': process.env.INTERNAL_API_KEY
          },
          body: JSON.stringify({ client_id: clientId, week_no: 1 })
        });
      } catch (genErr) {
        console.error('Week 1 generation trigger failed:', genErr.message);
      }
    }

    return res.status(200).json({ success: true, client_id: clientId });
  } catch (err) {
    console.error('Exly webhook error:', err.message);

    // Escalate payment failures
    if (req.body?.data?.phone) {
      await escalateToMaddy({
        reason: 'Payment processing error',
        phone: req.body.data.phone,
        context: err.message
      }).catch(() => {});
    }

    return res.status(500).json({ error: 'Processing failed' });
  }
};

function mapExlyProduct(productId) {
  if (!productId) return '6wk_gym';
  const p = String(productId).toLowerCase();
  if (p.includes('12') || p.includes('flagship') || p.includes('custom')) return '12wk';
  if (p.includes('pcos')) return 'pcos';
  if (p.includes('40') || p.includes('plus')) return '40plus';
  if (p.includes('home')) return '6wk_home';
  if (p.includes('trial')) return 'zoom_trial';
  if (p.includes('zoom') || p.includes('pack')) return 'zoom_pack';
  return '6wk_gym';
}

function getOnboardMessage(program, name) {
  const greeting = name ? `Hey ${name}!` : 'Hey!';
  const messages = {
    '6wk_gym': `${greeting} Welcome to the 6-Week Burn & Build! Your workout plan and nutrition guide are ready. Let's crush this together! Your first check-in is in 7 days.`,
    '6wk_home': `${greeting} Welcome to the 6-Week Home Program! Everything you need, no gym required. Your plan is ready. First check-in in 7 days!`,
    '12wk': `${greeting} Welcome to the 12-Week Flagship! This is where real transformation happens. Your Week 1 plan is being prepared right now. Get ready!`,
    'pcos': `${greeting} Welcome to PCOS Warrior! This program is designed specifically for hormonal balance. Your plan is ready — let's start this journey!`,
    '40plus': `${greeting} Welcome to 40+ Strong! Joint-friendly, science-backed training designed for your body. Your plan is ready!`,
    'zoom_trial': `${greeting} Your trial Zoom session is confirmed! Check your email for the scheduling link. Looking forward to meeting you!`,
    'zoom_pack': `${greeting} Your Zoom session pack is confirmed! Check your email for scheduling details.`
  };
  return messages[program] || messages['6wk_gym'];
}
