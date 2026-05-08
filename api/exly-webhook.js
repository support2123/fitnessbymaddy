const { supabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const crypto = require('crypto');

const PROGRAM_DURATIONS = {
  '6wk_gym': 42, '6wk_home': 42,
  '12wk': 84, 'pcos': 42,
  '40plus': 42, 'zoom_trial': 7, 'zoom_pack': 30
};

function verifyWebhookSignature(req) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true;
  const signature = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'];
  if (!signature) return false;
  const computed = crypto.createHmac('sha256', secret).update(JSON.stringify(req.body)).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(computed));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  if (!verifyWebhookSignature(req)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  try {
    const {
      phone, email, name, amount, checkout_id,
      product_name, product_id
    } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone' });
    }

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    const program = lead?.program_interest || inferProgram(product_name);
    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const programEnds = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString();

    const { data: newClient, error: clientErr } = await supabase
      .from('clients')
      .insert({
        lead_id: lead?.id || null,
        phone,
        name: name || lead?.name,
        email,
        program,
        program_started_at: new Date().toISOString(),
        program_ends_at: programEnds,
        paid_amount: amount ? Math.round(amount * 100) : 0,
        checkout_id: checkout_id || product_id,
        folder_url: null,
        status: 'active'
      })
      .select()
      .single();

    if (clientErr) {
      console.error('Client creation error:', clientErr.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    if (lead) {
      await supabase
        .from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const folderPath = `clients/${newClient.id}`;
    await supabase.storage.from('programs').upload(
      `${folderPath}/.keep`,
      new Blob([''], { type: 'text/plain' }),
      { upsert: true }
    );

    await supabase
      .from('clients')
      .update({ folder_url: folderPath })
      .eq('id', newClient.id);

    const isIN = (lead?.market || 'GLOBAL') === 'IN';
    const welcomeMsg = isIN
      ? `Welcome to FitnessByMaddy! Aapka ${program} program start ho gaya hai. Week 1 ka check-in Sunday ko aayega. Let's go!`
      : `Welcome to FitnessByMaddy! Your ${program} program has started. Your Week 1 check-in will arrive on Sunday. Let's go!`;

    await sendWhatsApp({
      phone,
      templateName: `onboard_${program}`,
      body: welcomeMsg,
      isClient: true
    });

    if (program === '12wk') {
      try {
        const origin = `https://${req.headers.host}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: newClient.id, week_no: 1 })
        });
      } catch (e) {
        console.error('Week-1 program gen failed:', e.message);
      }
    }

    return res.status(200).json({ success: true, client_id: newClient.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function inferProgram(productName) {
  if (!productName) return '6wk_gym';
  const lower = productName.toLowerCase();
  if (lower.includes('12') || lower.includes('custom')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40')) return '40plus';
  if (lower.includes('trial') || lower.includes('zoom')) return 'zoom_trial';
  if (lower.includes('home')) return '6wk_home';
  return '6wk_gym';
}
