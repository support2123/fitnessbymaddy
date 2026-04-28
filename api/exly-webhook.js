const crypto = require('crypto');
const { supabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const signature = req.headers['x-exly-signature'];
    if (process.env.EXLY_WEBHOOK_SECRET && signature) {
      const expected = crypto
        .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (signature !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const { checkout_id, phone, name, email, amount, product_name } = req.body;
    if (!phone) return res.status(400).json({ error: 'phone required' });

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .limit(1)
      .single();

    let leadId = lead?.id;
    if (!leadId) {
      const { data: newLead } = await supabase
        .from('leads')
        .insert({ phone, name, source: 'exly', status: 'converted' })
        .select()
        .single();
      leadId = newLead.id;
    } else {
      await supabase
        .from('leads')
        .update({ status: 'converted', name: name || lead.name })
        .eq('id', leadId);
    }

    const program = mapExlyProduct(product_name, lead?.program_interest);
    const programWeeks = program === '12wk' ? 12 : program === '6wk_gym' || program === '6wk_home' ? 6 : 4;
    const programEnds = new Date();
    programEnds.setDate(programEnds.getDate() + programWeeks * 7);

    const { data: client } = await supabase
      .from('clients')
      .insert({
        lead_id: leadId,
        phone,
        name,
        email,
        program,
        paid_amount: amount || 0,
        checkout_id,
        program_ends_at: programEnds.toISOString(),
        status: 'active'
      })
      .select()
      .single();

    const folderPath = `clients/${client.id}`;
    await supabase.storage
      .from('clients')
      .upload(`${folderPath}/.keep`, new Uint8Array(0), { upsert: true });

    await supabase
      .from('clients')
      .update({ folder_url: folderPath })
      .eq('id', client.id);

    const templateName = `onboard_${program}`;
    await sendTemplate(phone, templateName, [name || 'there']);

    if (program === '12wk') {
      const origin = req.headers['x-forwarded-host'] || req.headers.host || 'www.fitnessbymaddy.com';
      const protocol = req.headers['x-forwarded-proto'] || 'https';
      await fetch(`${protocol}://${origin}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: client.id, week_no: 1 })
      }).catch(() => {});
    }

    return res.status(200).json({ ok: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function mapExlyProduct(productName, fallbackProgram) {
  if (!productName && fallbackProgram) return fallbackProgram;
  if (!productName) return '6wk_gym';
  const lower = productName.toLowerCase();
  if (lower.includes('12') || lower.includes('flagship') || lower.includes('custom')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40') || lower.includes('strong')) return '40plus';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('trial') || lower.includes('zoom')) return 'zoom_trial';
  if (lower.includes('shred') || lower.includes('burn') || lower.includes('6')) return '6wk_gym';
  return fallbackProgram || '6wk_gym';
}
