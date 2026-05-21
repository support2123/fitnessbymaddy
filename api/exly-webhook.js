const { getClient } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/market');
const crypto = require('crypto');

const PROGRAM_MAP = {
  '6_week_shred_gym': '6wk_gym',
  '6_week_shred_home': '6wk_home',
  '12_week_custom': '12wk',
  'pcos_warrior': 'pcos',
  '40_plus_strong': '40plus',
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
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const secret = process.env.EXLY_WEBHOOK_SECRET;
    if (secret) {
      const sig = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'];
      if (sig) {
        const expected = crypto.createHmac('sha256', secret).update(JSON.stringify(req.body)).digest('hex');
        if (sig !== expected) {
          return res.status(401).json({ error: 'Invalid signature' });
        }
      }
    }

    const {
      phone, email, name, product, amount, checkout_id, order_id
    } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone required' });

    const supabase = getClient();
    const program = PROGRAM_MAP[product] || product || '12wk';
    const durationDays = PROGRAM_DURATIONS[program] || 42;

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (lead) {
      await supabase.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const now = new Date();
    const endsAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);
    const folderPath = `clients/${checkout_id || order_id || Date.now()}`;

    const { data: client, error: clientErr } = await supabase
      .from('clients')
      .insert({
        lead_id: lead ? lead.id : null,
        phone,
        name: name || (lead ? lead.name : null),
        email,
        program,
        program_started_at: now.toISOString(),
        program_ends_at: endsAt.toISOString(),
        paid_amount: amount ? parseInt(amount) : null,
        checkout_id: checkout_id || order_id,
        folder_url: folderPath,
        status: 'active'
      })
      .select()
      .single();

    if (clientErr) {
      console.error('Client insert error:', clientErr.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    await supabase.storage
      .from('client-data')
      .upload(`${folderPath}/.keep`, '', { contentType: 'text/plain', upsert: true });

    await sendTemplate(supabase, phone, `onboard_${program}`, {
      name: client.name || 'there',
      program: program,
      end_date: endsAt.toLocaleDateString('en-IN')
    });

    if (email) {
      try {
        const { Resend } = require('resend');
        const resend = new Resend(process.env.RESEND_API_KEY);
        await resend.emails.send({
          from: 'Fitness by Maddy <support@fitnessbymaddy.com>',
          to: email,
          subject: `Welcome to ${program.replace(/_/g, ' ').toUpperCase()} - Fitness by Maddy`,
          html: `<p>Hi ${client.name || 'there'},</p>
            <p>Welcome to Fitness by Maddy! Your ${program.replace(/_/g, ' ')} program starts now.</p>
            <p>You'll receive your first check-in form in 7 days. Keep an eye on WhatsApp for updates.</p>
            <p>Let's do this!</p>
            <p>- Team Maddy</p>`
        });
      } catch (emailErr) {
        console.error('Welcome email failed:', emailErr.message);
      }
    }

    if (program === '12wk') {
      try {
        const origin = `https://${req.headers.host}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (genErr) {
        console.error('Week-1 program generation failed:', genErr.message);
      }
    }

    console.log(`Conversion: ${maskPhone(phone)} -> ${program}`);
    return res.status(200).json({ ok: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
