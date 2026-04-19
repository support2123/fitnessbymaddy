const crypto = require('crypto');
const { getSupabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { Resend } = require('resend');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabase = getSupabase();

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

    const {
      phone, email, name, checkout_id,
      amount, product_name
    } = req.body;

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    const programMap = {
      '6wk_gym': { weeks: 6 },
      '6wk_home': { weeks: 6 },
      '12wk': { weeks: 12 },
      'pcos': { weeks: 8 },
      '40plus': { weeks: 8 },
      'zoom_trial': { weeks: 1 },
      'zoom_pack': { weeks: 4 }
    };

    let program = null;
    const pLower = (product_name || '').toLowerCase();
    if (pLower.includes('12') || pLower.includes('flagship') || pLower.includes('custom')) program = '12wk';
    else if (pLower.includes('pcos')) program = 'pcos';
    else if (pLower.includes('40')) program = '40plus';
    else if (pLower.includes('home')) program = '6wk_home';
    else if (pLower.includes('trial') || pLower.includes('zoom')) program = 'zoom_trial';
    else if (pLower.includes('shred') || pLower.includes('burn') || pLower.includes('6')) program = '6wk_gym';

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .maybeSingle();

    if (lead) {
      await supabase.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const programWeeks = programMap[program]?.weeks || 6;
    const startDate = new Date();
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + programWeeks * 7);

    const { data: client, error } = await supabase.from('clients').upsert({
      lead_id: lead?.id || null,
      phone,
      name: name || lead?.name,
      email,
      program: program || '6wk_gym',
      program_started_at: startDate.toISOString(),
      program_ends_at: endDate.toISOString(),
      paid_amount: amount ? parseInt(amount) : null,
      checkout_id,
      folder_url: null,
      status: 'active'
    }, { onConflict: 'phone', ignoreDuplicates: false })
      .select().single();

    if (error) throw error;

    const folderPath = `clients/${client.id}`;
    await supabase.storage
      .from('programs')
      .upload(`${folderPath}/.keep`, new Uint8Array(0), { upsert: true });

    await supabase.from('clients')
      .update({ folder_url: folderPath })
      .eq('id', client.id);

    const templateName = `onboard_${program || '6wk_gym'}`;
    await sendTemplate(phone, templateName, lead?.market || 'GLOBAL', [name || 'there']);

    if (email) {
      try {
        const resend = new Resend(process.env.RESEND_API_KEY);
        await resend.emails.send({
          from: 'Fitness by Maddy <support@fitnessbymaddy.com>',
          to: email,
          subject: `Welcome to ${program === '12wk' ? '12-Week Flagship' : 'Fitness by Maddy'}!`,
          html: `<h2>Welcome, ${name || 'there'}!</h2>
            <p>Your program is now active. You'll receive your first check-in form in 7 days.</p>
            <p>If you have any questions, reply to this email or message us on WhatsApp.</p>
            <p>— Team Fitness by Maddy</p>`
        });
      } catch (emailErr) {
        console.error('Welcome email failed:', emailErr.message);
      }
    }

    if (program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://fitnessbymaddy.com';

        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (genErr) {
        console.error('Week-1 program generation failed:', genErr.message);
      }
    }

    return res.json({ success: true, client_id: client.id, program });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
