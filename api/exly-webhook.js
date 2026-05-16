const { supabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { getProgramDetails } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const signature = req.headers['x-exly-signature'] || req.headers['x-webhook-secret'];
    if (process.env.EXLY_WEBHOOK_SECRET && signature !== process.env.EXLY_WEBHOOK_SECRET) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const { phone, email, name, product, amount, checkout_id } = req.body;
    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    const programMap = {
      '6_week_shred': '6wk_gym',
      '6_week_home': '6wk_home',
      '12_week_custom': '12wk',
      'pcos_warrior': 'pcos',
      '40_plus_strong': '40plus',
      'zoom_trial': 'zoom_trial',
      'zoom_pack': 'zoom_pack'
    };

    const program = programMap[product] || product;
    const details = getProgramDetails(program);
    const weeks = details ? details.weeks : 6;

    let { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (lead) {
      await supabase.from('leads').update({
        status: 'converted',
        name: name || lead.name,
        program_interest: program
      }).eq('id', lead.id);
    } else {
      const { data: newLead } = await supabase.from('leads').insert({
        phone,
        name,
        source: 'exly',
        status: 'converted',
        program_interest: program
      }).select().single();
      lead = newLead;
    }

    const programEndsAt = new Date();
    programEndsAt.setDate(programEndsAt.getDate() + weeks * 7);

    const { data: client } = await supabase.from('clients').insert({
      lead_id: lead.id,
      phone,
      name: name || lead?.name,
      email,
      program,
      program_started_at: new Date().toISOString(),
      program_ends_at: programEndsAt.toISOString(),
      paid_amount: amount ? parseInt(amount) : details?.price,
      checkout_id,
      status: 'active'
    }).select().single();

    if (client) {
      const folderPath = `clients/${client.id}/.keep`;
      await supabase.storage
        .from('client-files')
        .upload(folderPath, new Uint8Array(0), { upsert: true });

      await supabase.from('clients').update({
        folder_url: `/clients/${client.id}/`
      }).eq('id', client.id);
    }

    await sendWhatsApp(phone, `onboard_${program}`, {
      name: name || 'there',
      templateParams: [name || 'there', details?.name || program, String(weeks)]
    });

    if (program === '12wk' && client) {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://fitnessbymaddy.com';

        fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (e) {
        console.error('Week 1 generation trigger failed:', e.message);
      }
    }

    return res.json({ success: true, clientId: client?.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
