const db = require('./_lib/supabase');
const wa = require('./_lib/whatsapp');
const { verifyExlyWebhook, detectMarket, isHinglish, programDisplayName, maskPhone } = require('./_lib/utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  if (!verifyExlyWebhook(req)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  try {
    const {
      customer_phone, customer_name, customer_email,
      product_name, amount, checkout_id, order_id,
    } = req.body;

    const phone = customer_phone;
    if (!phone) return res.status(400).json({ error: 'No phone' });

    const leads = await db.query('leads', `phone=eq.${phone}&select=*`);
    let lead = leads[0];

    if (!lead) {
      lead = (await db.insert('leads', {
        phone,
        name: customer_name,
        source: 'exly',
        status: 'converted',
        program_interest: mapProductToProgram(product_name),
        market: detectMarket(phone),
      }))[0];
    } else {
      await db.update('leads', { id: lead.id }, { status: 'converted' });
    }

    const program = lead.program_interest || mapProductToProgram(product_name);
    const programWeeks = program === '12wk' ? 12 : program.startsWith('6wk') ? 6 : 4;
    const now = new Date();
    const endsAt = new Date(now.getTime() + programWeeks * 7 * 24 * 60 * 60 * 1000);

    const existingClients = await db.query('clients', `phone=eq.${phone}&lead_id=eq.${lead.id}&select=id`);

    let client;
    if (existingClients.length > 0) {
      client = (await db.update('clients', { id: existingClients[0].id }, {
        program,
        program_started_at: now.toISOString(),
        program_ends_at: endsAt.toISOString(),
        paid_amount: amount || 0,
        checkout_id: checkout_id || order_id,
        status: 'active',
        email: customer_email,
        name: customer_name || lead.name,
      }))[0];
    } else {
      client = (await db.insert('clients', {
        lead_id: lead.id,
        phone,
        name: customer_name || lead.name,
        email: customer_email,
        program,
        program_started_at: now.toISOString(),
        program_ends_at: endsAt.toISOString(),
        paid_amount: amount || 0,
        checkout_id: checkout_id || order_id,
        folder_url: `/clients/${lead.id}/`,
        status: 'active',
      }))[0];
    }

    const hinglish = isHinglish(detectMarket(phone));
    const displayName = programDisplayName(program);

    const welcomeMsg = hinglish
      ? `Welcome to the family! 🎉 Tera "${displayName}" program shuru ho gaya hai. Week 1 ka plan jald aayega. Koi question? Yahan message kar!`
      : `Welcome to the family! 🎉 Your "${displayName}" program starts now. Your Week 1 plan is coming soon. Any questions? Message here!`;

    try {
      await wa.sendTemplate(phone, `onboard_${program}`, [displayName], customer_name || 'there');
    } catch {
      try {
        await wa.sendTemplate(phone, 'onboard_generic', [displayName], customer_name || 'there');
      } catch {
        console.error(`Onboard template failed for ${maskPhone(phone)}`);
      }
    }

    await db.insert('messages', {
      phone,
      direction: 'out',
      body: welcomeMsg,
      template_name: `onboard_${program}`,
      sent_at: new Date().toISOString(),
      status: 'sent',
    });

    return res.status(200).json({ ok: true, client_id: client.id, program });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Processing failed' });
  }
};

function mapProductToProgram(productName) {
  if (!productName) return '6wk_gym';
  const lower = productName.toLowerCase();
  if (lower.includes('12') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40') || lower.includes('strong')) return '40plus';
  if (lower.includes('zoom') && lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('zoom')) return 'zoom_pack';
  if (lower.includes('home')) return '6wk_home';
  return '6wk_gym';
}
