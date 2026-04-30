const { supabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { maskPhone } = require('./_lib/pii');
const crypto = require('crypto');

const PROGRAM_MAP = {
  '6wk_gym': { weeks: 6, label: '6-Week Burn & Build (Gym)' },
  '6wk_home': { weeks: 6, label: '6-Week Burn & Build (Home)' },
  '12wk': { weeks: 12, label: '12-Week Custom Training' },
  'pcos': { weeks: 6, label: 'PCOS Warrior' },
  '40plus': { weeks: 8, label: '40+ Strong' },
  'zoom_trial': { weeks: 1, label: 'Zoom Trial Session' },
  'zoom_pack': { weeks: 4, label: 'Zoom Sessions Pack' }
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const secret = process.env.EXLY_WEBHOOK_SECRET;
    if (secret && req.headers['x-exly-signature']) {
      const sig = crypto
        .createHmac('sha256', secret)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (sig !== req.headers['x-exly-signature']) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const { phone, email, name, amount, checkout_id, product_name } = req.body;
    const cleanPhone = (phone || '').replace(/[^0-9]/g, '');

    if (!cleanPhone) {
      return res.status(400).json({ error: 'Missing phone' });
    }

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', cleanPhone)
      .limit(1)
      .single();

    const program = lead?.program_interest || detectProgramFromProduct(product_name) || '6wk_gym';
    const programInfo = PROGRAM_MAP[program] || PROGRAM_MAP['6wk_gym'];

    if (lead) {
      await supabase.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const endDate = new Date();
    endDate.setDate(endDate.getDate() + programInfo.weeks * 7);

    const { data: client, error } = await supabase.from('clients').upsert({
      lead_id: lead?.id || null,
      phone: cleanPhone,
      name: name || lead?.name,
      email,
      program,
      program_started_at: new Date().toISOString(),
      program_ends_at: endDate.toISOString(),
      paid_amount: amount ? parseInt(amount) : null,
      checkout_id,
      folder_url: `/clients/${cleanPhone}/`,
      status: 'active'
    }, { onConflict: 'phone,program' }).select().single();

    if (error) throw error;

    const isHinglish = cleanPhone.startsWith('91');
    const welcomeMsg = isHinglish
      ? `Welcome to ${programInfo.label}! Tera transformation journey shuru ho gaya hai.\n\nWeek 1 ka plan jaldi aayega. Har Sunday check-in form milega — time pe bharna.\n\nQuestions? Yahan message kar.`
      : `Welcome to ${programInfo.label}! Your transformation journey starts now.\n\nYour Week 1 plan will arrive shortly. You'll get a check-in form every Sunday — please submit it on time.\n\nQuestions? Message us here.`;

    await sendWhatsApp(cleanPhone, welcomeMsg, `onboard_${program}`);

    if (program === '12wk') {
      try {
        const origin = `https://${req.headers.host}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (e) {
        console.error('Week 1 program generation failed:', e.message);
      }
    }

    console.log(`Conversion: ${maskPhone(cleanPhone)} → ${program}`);
    return res.status(200).json({ success: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function detectProgramFromProduct(productName) {
  if (!productName) return null;
  const lower = productName.toLowerCase();
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40+') || lower.includes('40 plus')) return '40plus';
  if (lower.includes('12') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('trial') || lower.includes('zoom')) return 'zoom_trial';
  if (lower.includes('shred') || lower.includes('6 week') || lower.includes('burn')) return '6wk_gym';
  return null;
}
