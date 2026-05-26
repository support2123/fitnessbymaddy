const crypto = require('crypto');
const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, detectMarket } = require('../lib/whatsapp');
const { escalateToMaddy } = require('../lib/escalation');

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
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    if (process.env.EXLY_WEBHOOK_SECRET) {
      const signature = req.headers['x-exly-signature'] || '';
      const expected = crypto
        .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (signature !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const {
      phone,
      name,
      email,
      program,
      amount,
      checkout_id,
      event_type
    } = req.body;

    if (event_type === 'payment.failed') {
      await escalateToMaddy(
        'Payment failed for lead',
        `Phone: ${phone}\nName: ${name}\nProgram: ${program}\nAmount: ${amount}`
      );
      return res.status(200).json({ ok: true, action: 'payment_failed_escalated' });
    }

    if (event_type !== 'payment.success' && event_type !== 'purchase') {
      return res.status(200).json({ ok: true, action: 'ignored_event' });
    }

    const normalizedPhone = normalizePhone(phone || '');
    if (!normalizedPhone) {
      return res.status(400).json({ error: 'Missing phone' });
    }

    const db = getSupabase();

    const { data: lead } = await db
      .from('leads')
      .select('id')
      .eq('phone', normalizedPhone)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const startsAt = new Date();
    const endsAt = new Date(startsAt.getTime() + durationDays * 24 * 60 * 60 * 1000);

    const { data: client } = await db
      .from('clients')
      .insert({
        lead_id: lead ? lead.id : null,
        phone: normalizedPhone,
        name: name || null,
        email: email || null,
        program: program || '6wk_gym',
        program_started_at: startsAt.toISOString(),
        program_ends_at: endsAt.toISOString(),
        paid_amount: amount ? parseInt(amount) : null,
        checkout_id: checkout_id || null,
        folder_url: null,
        status: 'active'
      })
      .select('id')
      .single();

    const folderPath = `clients/${client.id}`;
    await db.storage.from('clients').upload(`${client.id}/.keep`, new Uint8Array(0), {
      contentType: 'text/plain',
      upsert: true
    });

    await db.from('clients').update({
      folder_url: folderPath
    }).eq('id', client.id);

    const market = detectMarket(normalizedPhone);
    const welcomeMsg = market === 'IN'
      ? `Welcome to the family! 🎉 Aapka ${program} program start ho gaya hai. Hum aapko 7 din mein first check-in form bhejenge. Let's crush it!`
      : `Welcome to the family! 🎉 Your ${program} program has started. We'll send your first check-in form in 7 days. Let's crush it!`;

    await sendWhatsApp(normalizedPhone, [name || 'there', program], `onboard_${program}`);

    if (program === '12wk') {
      try {
        const origin = `https://${req.headers.host}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`
          },
          body: JSON.stringify({
            client_id: client.id,
            week_no: 1
          })
        });
      } catch (err) {
        console.error('Week-1 program generation failed:', err.message);
      }
    }

    return res.status(200).json({
      ok: true,
      action: 'client_created',
      clientId: client.id
    });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function normalizePhone(raw) {
  let cleaned = raw.replace(/[^0-9+]/g, '');
  if (!cleaned.startsWith('+')) cleaned = '+' + cleaned;
  return cleaned;
}
