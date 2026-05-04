const { supabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');

const PROGRAM_MAP = {
  '6wk_gym':     { weeks: 6,  name: '6-Week Burn & Build (Gym)' },
  '6wk_home':    { weeks: 6,  name: '6-Week Burn & Build (Home)' },
  '12wk':        { weeks: 12, name: '12-Week Flagship' },
  'pcos':        { weeks: 6,  name: 'PCOS Warrior' },
  '40plus':      { weeks: 6,  name: '40+ Strong' },
  'zoom_trial':  { weeks: 1,  name: 'Zoom Trial' },
  'zoom_pack':   { weeks: 4,  name: 'Zoom Pack' }
};

function detectProgram(productName) {
  const p = (productName || '').toLowerCase();
  if (p.includes('12') || p.includes('flagship') || p.includes('custom')) return '12wk';
  if (p.includes('pcos')) return 'pcos';
  if (p.includes('40')) return '40plus';
  if (p.includes('home')) return '6wk_home';
  if (p.includes('6') || p.includes('shred') || p.includes('burn')) return '6wk_gym';
  if (p.includes('zoom') && p.includes('pack')) return 'zoom_pack';
  if (p.includes('trial') || p.includes('zoom')) return 'zoom_trial';
  return 'zoom_trial';
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const sig = req.headers['x-exly-signature'] || req.headers['x-webhook-secret'];
  if (process.env.EXLY_WEBHOOK_SECRET && sig !== process.env.EXLY_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { phone, email, name, checkout_id, amount, product_name } = req.body;
    if (!phone) return res.status(400).json({ error: 'phone required' });

    const normalizedPhone = phone.replace(/[^0-9]/g, '');
    const program = detectProgram(product_name);
    const info = PROGRAM_MAP[program];

    const now = new Date();
    const endsAt = new Date(now);
    endsAt.setDate(endsAt.getDate() + info.weeks * 7);

    let { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', normalizedPhone)
      .single();

    if (!lead) {
      const { data: newLead } = await supabase
        .from('leads')
        .insert({
          phone: normalizedPhone,
          name,
          source: 'exly',
          status: 'converted'
        })
        .select()
        .single();
      lead = newLead;
    } else {
      await supabase.from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const { data: client } = await supabase
      .from('clients')
      .insert({
        lead_id: lead.id,
        phone: normalizedPhone,
        name: name || lead.name,
        email,
        program,
        program_started_at: now.toISOString(),
        program_ends_at: endsAt.toISOString(),
        paid_amount: amount ? Math.round(parseFloat(amount) * 100) : null,
        checkout_id,
        status: 'active'
      })
      .select()
      .single();

    const folderPath = `clients/${client.id}/.keep`;
    await supabase.storage
      .from('programs')
      .upload(folderPath, new Uint8Array(0), { upsert: true });

    await supabase.from('clients')
      .update({ folder_url: `clients/${client.id}/` })
      .eq('id', client.id);

    await sendTemplate(normalizedPhone, `onboard_${program}`, [
      name || lead.name || 'there',
      info.name,
      `${info.weeks} weeks`
    ]);

    if (program === '12wk') {
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'https://fitnessbymaddy.com';
      fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: client.id, week_no: 1 })
      }).catch(err => console.error('Week-1 gen trigger failed:', err.message));
    }

    return res.status(200).json({ ok: true, client_id: client.id, program });

  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
