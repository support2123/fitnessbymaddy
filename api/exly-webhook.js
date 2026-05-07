const crypto = require('crypto');
const { supabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { detectMarket, isHinglish } = require('./_lib/market');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const secret = process.env.EXLY_WEBHOOK_SECRET;
    if (secret) {
      const sig = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'];
      if (sig) {
        const expected = crypto.createHmac('sha256', secret)
          .update(JSON.stringify(req.body)).digest('hex');
        if (sig !== expected) {
          return res.status(401).json({ error: 'Invalid signature' });
        }
      }
    }

    const {
      phone, name, email, checkout_id, amount,
      product_name, product_id, status
    } = req.body;

    if (!phone || status !== 'completed') {
      return res.status(200).json({ status: 'ignored' });
    }

    const program = mapProductToProgram(product_name || product_id);
    const programDays = getProgramDuration(program);

    const { data: lead } = await supabase
      .from('leads').select('*').eq('phone', phone).single();

    if (lead) {
      await supabase.from('leads').update({
        status: 'converted',
        name: name || lead.name,
        program_interest: program
      }).eq('id', lead.id);
    }

    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + programDays * 24 * 60 * 60 * 1000);

    const { data: client, error: clientErr } = await supabase.from('clients').insert({
      lead_id: lead?.id || null,
      phone,
      name: name || lead?.name,
      email,
      program,
      program_started_at: startDate.toISOString(),
      program_ends_at: endDate.toISOString(),
      paid_amount: amount ? Math.round(amount * 100) : null,
      checkout_id,
      status: 'active'
    }).select().single();

    if (clientErr) {
      console.error('Client creation failed:', clientErr.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    const folderPath = `clients/${client.id}`;
    await supabase.storage.from('programs').upload(
      `${folderPath}/.keep`, new Blob([''])
    );
    await supabase.from('clients').update({
      folder_url: folderPath
    }).eq('id', client.id);

    const market = detectMarket(phone);
    const welcome = getOnboardMessage(program, market);
    await sendWhatsApp(phone, welcome, `onboard_${program}`, true);

    if (program === '12wk') {
      try {
        const origin = `https://${req.headers.host}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (e) {
        console.error('Week-1 program generation failed:', e.message);
      }
    }

    return res.status(200).json({ success: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function mapProductToProgram(productName) {
  if (!productName) return '6wk_gym';
  const lower = productName.toLowerCase();
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40')) return '40plus';
  if (lower.includes('12') || lower.includes('flagship') || lower.includes('custom')) return '12wk';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('zoom') && lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('zoom') && lower.includes('pack')) return 'zoom_pack';
  return '6wk_gym';
}

function getProgramDuration(program) {
  const durations = {
    '6wk_gym': 42, '6wk_home': 42, '12wk': 84,
    'pcos': 42, '40plus': 42, 'zoom_trial': 7, 'zoom_pack': 28
  };
  return durations[program] || 42;
}

function getOnboardMessage(program, market) {
  const hinglish = isHinglish(market);
  const messages = {
    '12wk': hinglish
      ? "Welcome to the 12-Week Flagship Program! 🚀🎉\n\nAapka customized Week 1 plan abhi generate ho raha hai. 24 hours mein aapko mil jayega.\n\nHar Sunday ko check-in form aayega — please fill karna. Let's crush this! 💪"
      : "Welcome to the 12-Week Flagship Program! 🚀🎉\n\nYour customized Week 1 plan is being generated now. You'll receive it within 24 hours.\n\nEvery Sunday you'll get a check-in form — please fill it out. Let's crush this! 💪",
    '6wk_gym': hinglish
      ? "Welcome to 6-Week Burn & Build! 🔥\n\nAapka program ready hai. Check-in form har Sunday aayega — please fill karna for best results.\n\nLet's do this! 💪"
      : "Welcome to 6-Week Burn & Build! 🔥\n\nYour program is ready. You'll receive a check-in form every Sunday — please fill it out for best results.\n\nLet's do this! 💪"
  };
  return messages[program] || messages['6wk_gym'];
}
