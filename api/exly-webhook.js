const { supabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const crypto = require('crypto');

const PROGRAM_MAP = {
  '6wk_gym': { duration: 42, name: '6-Week Burn & Build (Gym)' },
  '6wk_home': { duration: 42, name: '6-Week Burn & Build (Home)' },
  '12wk': { duration: 84, name: '12-Week Flagship' },
  'pcos': { duration: 42, name: 'PCOS Warrior' },
  '40plus': { duration: 42, name: '40+ Strong' },
  'zoom_trial': { duration: 7, name: 'Zoom Trial' },
  'zoom_pack': { duration: 30, name: 'Zoom Pack' }
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    // Verify webhook signature if secret is set
    const secret = process.env.EXLY_WEBHOOK_SECRET;
    if (secret && req.headers['x-exly-signature']) {
      const sig = req.headers['x-exly-signature'];
      const expected = crypto.createHmac('sha256', secret)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (sig !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const {
      buyer_phone, buyer_name, buyer_email,
      product_id, checkout_id, amount, program
    } = req.body;

    if (!buyer_phone) {
      return res.status(400).json({ error: 'buyer_phone required' });
    }

    const phone = buyer_phone.startsWith('+') ? buyer_phone : `+${buyer_phone}`;
    const programKey = program || product_id || '6wk_gym';
    const programInfo = PROGRAM_MAP[programKey] || PROGRAM_MAP['6wk_gym'];

    // Find or update lead
    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1);

    const leadId = lead && lead[0] ? lead[0].id : null;

    if (leadId) {
      await supabase.from('leads').update({ status: 'converted' }).eq('id', leadId);
    }

    // Calculate program end date
    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + programInfo.duration * 24 * 60 * 60 * 1000);

    // Create client
    const { data: client, error } = await supabase.from('clients').insert({
      lead_id: leadId,
      phone,
      name: buyer_name || (lead && lead[0] ? lead[0].name : null),
      email: buyer_email,
      program: programKey,
      program_started_at: startDate.toISOString(),
      program_ends_at: endDate.toISOString(),
      paid_amount: amount ? parseInt(amount) : null,
      checkout_id,
      folder_url: null,
      status: 'active'
    }).select().single();

    if (error) throw error;

    // Create storage folder
    const folderPath = `clients/${client.id}/.keep`;
    await supabase.storage.from('programs').upload(folderPath, new Uint8Array(0), {
      contentType: 'text/plain',
      upsert: true
    });

    const folderUrl = `clients/${client.id}/`;
    await supabase.from('clients').update({ folder_url: folderUrl }).eq('id', client.id);

    // Send onboarding WhatsApp
    await sendTemplate(phone, `onboard_${programKey}`, [
      buyer_name || 'there',
      programInfo.name
    ]);

    // Send welcome email via Resend
    if (buyer_email) {
      try {
        const { Resend } = require('resend');
        const resend = new Resend(process.env.RESEND_API_KEY);
        await resend.emails.send({
          from: 'Maddy <support@fitnessbymaddy.com>',
          to: buyer_email,
          subject: `Welcome to ${programInfo.name}!`,
          html: `<h2>Welcome, ${buyer_name || 'there'}!</h2>
            <p>You're officially enrolled in the <strong>${programInfo.name}</strong> program.</p>
            <p>Your program starts today and runs for ${programInfo.duration} days.</p>
            <p>You'll receive your first check-in form on Day 7 via WhatsApp.</p>
            <p>Let's do this!</p>
            <p>— Maddy & Team</p>`
        });
      } catch (emailErr) {
        console.error('Welcome email failed:', emailErr.message);
      }
    }

    // For 12-week program: generate Week 1 immediately
    if (programKey === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://fitnessbymaddy.com';

        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`
          },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (genErr) {
        console.error('Week 1 program generation failed:', genErr.message);
      }
    }

    return res.status(200).json({ ok: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
