const { getSupabase } = require('./_lib/supabase');
const { sendTemplate, notifyMaddy } = require('./_lib/whatsapp');
const { normalizePhone, maskPhone, detectMarket } = require('./_lib/phone');
const crypto = require('crypto');

const PROGRAM_MAP = {
  '6_week_shred': '6wk_gym',
  '6_week_home': '6wk_home',
  '12_week_custom': '12wk',
  'pcos_warrior': 'pcos',
  '40_plus': '40plus',
  'zoom_trial': 'zoom_trial',
  'zoom_pack': 'zoom_pack'
};

const PROGRAM_DURATIONS = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 30
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const signature = req.headers['x-webhook-signature'] || req.headers['x-exly-signature'] || '';
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
      phone, email, name, amount, checkout_id,
      product_name, product_id, status: paymentStatus
    } = req.body;

    if (!phone || paymentStatus !== 'completed') {
      return res.status(200).json({ action: 'ignored', reason: 'incomplete or no phone' });
    }

    const normalizedPhone = normalizePhone(phone);
    const supabase = getSupabase();

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', normalizedPhone)
      .single();

    if (lead) {
      await supabase
        .from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const program = PROGRAM_MAP[product_id] || PROGRAM_MAP[product_name] || lead?.program_interest || '12wk';
    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const now = new Date();
    const endsAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

    const { data: client } = await supabase
      .from('clients')
      .insert({
        lead_id: lead?.id || null,
        phone: normalizedPhone,
        name: name || lead?.name || null,
        email: email || null,
        program,
        program_started_at: now.toISOString(),
        program_ends_at: endsAt.toISOString(),
        paid_amount: amount ? parseInt(amount, 10) : null,
        checkout_id: checkout_id || null,
        folder_url: null,
        status: 'active'
      })
      .select()
      .single();

    const folderPath = `clients/${client.id}`;
    const placeholderBuffer = Buffer.from('client folder initialized');
    await supabase.storage
      .from('clients')
      .upload(`${folderPath}/.init`, placeholderBuffer, { upsert: true });

    await supabase
      .from('clients')
      .update({ folder_url: folderPath })
      .eq('id', client.id);

    const market = detectMarket(normalizedPhone);
    const welcomeParams = market === 'IN'
      ? [`Welcome to ${program.replace(/_/g, ' ')} program! Aapka journey shuru ho gaya hai. Week 1 ka check-in form Sunday ko aayega.`]
      : [`Welcome to the ${program.replace(/_/g, ' ')} program! Your journey starts now. Your Week 1 check-in form will arrive on Sunday.`];

    await sendTemplate(normalizedPhone, `onboard_${program}`, welcomeParams);

    if (program === '12wk') {
      try {
        const generateUrl = `https://${req.headers.host}/api/generate-program`;
        fetch(generateUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        }).catch(err => console.error('Week-1 generation trigger failed:', err.message));
      } catch (e) {
        console.error('Failed to trigger program generation:', e.message);
      }
    }

    return res.status(200).json({
      success: true,
      client_id: client.id,
      program
    });
  } catch (err) {
    console.error('Exly webhook error:', err.message);

    if (req.body?.phone) {
      await notifyMaddy(
        'Payment webhook error',
        `Phone: ${maskPhone(normalizePhone(req.body.phone))}\nError: ${err.message}`
      ).catch(() => {});
    }

    return res.status(500).json({ error: 'Internal error' });
  }
};
