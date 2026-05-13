const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');
const { maskPhone } = require('./lib/mask-phone');
const { getProgramName } = require('./lib/qualify');

const PROGRAM_DURATION_DAYS = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 1,
  'zoom_pack': 30
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).json({});
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // 1. Verify webhook secret
    const secret = req.headers['x-webhook-secret'];
    if (!secret || secret !== process.env.EXLY_WEBHOOK_SECRET) {
      console.warn('Exly webhook: invalid secret');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // 2. Extract fields
    const { phone, email, name, checkout_id, amount, product_name } = req.body || {};

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone' });
    }

    console.log(`Exly purchase: ${maskPhone(phone)}, product=${product_name}, amount=${amount}`);

    const db = getSupabase();

    // 3. Find or create lead, update status to converted
    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    let leadId;

    if (existingLead) {
      leadId = existingLead.id;
      await db
        .from('leads')
        .update({
          status: 'converted',
          name: name || existingLead.name,
          last_msg_at: new Date().toISOString()
        })
        .eq('phone', phone);
    } else {
      const { data: newLead, error: insertErr } = await db
        .from('leads')
        .insert({
          phone,
          name: name || null,
          source: 'exly',
          status: 'converted',
          last_msg_at: new Date().toISOString()
        })
        .select()
        .single();

      if (insertErr) {
        console.error(`Failed to create lead for ${maskPhone(phone)}:`, insertErr.message);
        return res.status(500).json({ error: 'Failed to create lead' });
      }
      leadId = newLead.id;
    }

    // 4. Map product_name to program key
    const programKey = mapProductToProgram(product_name);

    // 5. Calculate program end date
    const durationDays = PROGRAM_DURATION_DAYS[programKey] || 42;
    const now = new Date();
    const endsAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

    // 6. Insert into clients table
    const { error: clientErr } = await db
      .from('clients')
      .insert({
        lead_id: leadId,
        phone,
        name: name || null,
        email: email || null,
        program: programKey,
        program_started_at: now.toISOString(),
        program_ends_at: endsAt.toISOString(),
        paid_amount: amount ? Math.round(Number(amount)) : null,
        checkout_id: checkout_id || null,
        status: 'active'
      });

    if (clientErr) {
      console.error(`Failed to create client for ${maskPhone(phone)}:`, clientErr.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    // 7. Send onboarding WhatsApp message
    const programName = getProgramName(programKey);
    const onboardingMsg =
      `Welcome to ${programName}! You're officially in.\n\n` +
      `Here's what happens next:\n` +
      `1. You'll receive your personalised plan within 24 hours\n` +
      `2. Weekly check-ins every Sunday\n` +
      `3. Direct WhatsApp support throughout your journey\n\n` +
      `Let's get started! If you haven't filled out your intake form yet, please do so ASAP so we can build your plan.`;

    await sendWhatsApp(phone, onboardingMsg, 'onboarding_welcome');

    console.log(`Client created: ${maskPhone(phone)}, program=${programKey}, ends=${endsAt.toISOString().slice(0, 10)}`);
    return res.status(200).json({ ok: true, program: programKey, client_created: true });

  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function mapProductToProgram(productName) {
  if (!productName) return '6wk_gym';

  const lower = productName.toLowerCase();

  if (lower.includes('pcos') || lower.includes('pcod')) return 'pcos';
  if (lower.includes('40+') || lower.includes('40 plus') || lower.includes('40plus')) return '40plus';
  if (lower.includes('12') && (lower.includes('week') || lower.includes('wk'))) return '12wk';
  if (lower.includes('zoom') && lower.includes('pack')) return 'zoom_pack';
  if (lower.includes('zoom') || lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('home')) return '6wk_home';

  return '6wk_gym';
}
