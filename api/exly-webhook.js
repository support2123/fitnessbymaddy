const crypto = require('crypto');
const { supabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');

const PROGRAM_DURATIONS = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 30
};

function verifyExlySignature(body, signature) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(body))
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature || ''),
    Buffer.from(expected)
  );
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const signature = req.headers['x-exly-signature'];
    if (process.env.EXLY_WEBHOOK_SECRET && !verifyExlySignature(req.body, signature)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const {
      phone, name, email, amount, checkout_id, product_name
    } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'phone required' });
    }

    const normalizedPhone = phone.startsWith('+') ? phone : `+${phone}`;

    const program = mapProductToProgram(product_name);

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

    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const programEnds = new Date();
    programEnds.setDate(programEnds.getDate() + durationDays);

    const clientData = {
      lead_id: lead?.id || null,
      phone: normalizedPhone,
      name: name || lead?.name,
      email,
      program,
      paid_amount: amount ? parseInt(amount) : null,
      checkout_id,
      program_ends_at: programEnds.toISOString(),
      status: 'active'
    };

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id')
      .eq('phone', normalizedPhone)
      .eq('program', program)
      .single();

    let clientId;
    if (existingClient) {
      await supabase
        .from('clients')
        .update(clientData)
        .eq('id', existingClient.id);
      clientId = existingClient.id;
    } else {
      const { data: newClient } = await supabase
        .from('clients')
        .insert(clientData)
        .select()
        .single();
      clientId = newClient.id;
    }

    const folderPath = `clients/${clientId}`;
    await supabase
      .from('clients')
      .update({ folder_url: folderPath })
      .eq('id', clientId);

    const market = detectMarket(normalizedPhone);
    const hinglish = isHinglish(market);

    const welcomeBody = hinglish
      ? `Welcome to the family! \u{1F525} Tumhara ${getReadableProgramName(program)} officially shuru ho gaya hai.\n\nNext step: Apna intake form fill karo (agar abhi tak nahi kiya) aur pehla check-in Day 7 pe aayega.\n\nLet's crush this! \u{1F4AA}`
      : `Welcome to the family! \u{1F525} Your ${getReadableProgramName(program)} has officially started.\n\nNext step: Fill your intake form (if not done yet) and your first check-in will be on Day 7.\n\nLet's crush this! \u{1F4AA}`;

    await sendWhatsApp({
      phone: normalizedPhone,
      templateName: `onboard_${program}`,
      params: [name || 'there'],
      body: welcomeBody
    });

    if (program === '12wk') {
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'https://fitnessbymaddy.com';

      try {
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`
          },
          body: JSON.stringify({ client_id: clientId, week_no: 1 })
        });
      } catch (err) {
        console.error('Week 1 program generation failed:', err.message);
      }
    }

    return res.status(200).json({ success: true, clientId });
  } catch (error) {
    console.error('Exly webhook error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function mapProductToProgram(productName) {
  if (!productName) return '6wk_gym';
  const lower = productName.toLowerCase();
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40+') || lower.includes('40 plus')) return '40plus';
  if (lower.includes('12') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('zoom') && lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('zoom') && lower.includes('pack')) return 'zoom_pack';
  if (lower.includes('home')) return '6wk_home';
  return '6wk_gym';
}

function getReadableProgramName(program) {
  const names = {
    '6wk_gym': '6-Week Burn & Build (Gym)',
    '6wk_home': '6-Week Burn & Build (Home)',
    '12wk': '12-Week Custom Flagship Program',
    'pcos': 'PCOS Warrior Program',
    '40plus': '40+ Strong Program',
    'zoom_trial': 'Zoom Trial Session',
    'zoom_pack': 'Zoom Session Pack'
  };
  return names[program] || program;
}
