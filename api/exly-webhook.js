const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { isHinglish } = require('../lib/market');
const { escalateToMaddy, PROGRAM_NAMES } = require('../lib/escalation');
const crypto = require('crypto');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const signature = req.headers['x-webhook-signature'];
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
      checkout_id,
      lead_id,
      phone,
      name,
      email,
      program,
      amount,
      status: paymentStatus,
    } = req.body;

    if (paymentStatus === 'failed') {
      await escalateToMaddy({
        reason: 'Payment failure for lead',
        phone: phone || 'unknown',
        context: `Checkout ${checkout_id}, Program: ${program}`,
      });
      return res.json({ action: 'payment_failed_escalated' });
    }

    const db = getSupabase();

    let lead;
    if (lead_id) {
      const { data } = await db.from('leads').select('*').eq('id', lead_id).single();
      lead = data;
    }
    if (!lead && phone) {
      const { data } = await db
        .from('leads')
        .select('*')
        .eq('phone', phone)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      lead = data;
    }

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const programKey = mapExlyProgram(program);
    const programWeeks = programKey === '12wk' ? 12 : 6;
    const endsAt = new Date();
    endsAt.setDate(endsAt.getDate() + programWeeks * 7);

    const { data: client } = await db
      .from('clients')
      .insert({
        lead_id: lead?.id || null,
        phone: phone || lead?.phone,
        name: name || lead?.name,
        email,
        program: programKey,
        paid_amount: amount ? parseInt(amount) : 0,
        checkout_id,
        program_started_at: new Date().toISOString(),
        program_ends_at: endsAt.toISOString(),
        status: 'active',
      })
      .select()
      .single();

    const folderPath = `clients/${client.id}`;
    await db.storage.from('programs').upload(`${folderPath}/.keep`, new Blob(['']));

    await db.from('clients').update({ folder_url: folderPath }).eq('id', client.id);

    const market = lead?.market || 'GLOBAL';
    const hinglish = isHinglish(market);
    const pName = PROGRAM_NAMES[programKey] || programKey;

    const body = hinglish
      ? `Welcome to the family! 🎉 Tumhara ${pName} ab officially start ho gaya hai.\n\n` +
        `📋 Week 1 ka check-in Day 7 pe aayega\n` +
        `💪 Let's crush this together!`
      : `Welcome to the family! 🎉 Your ${pName} has officially started.\n\n` +
        `📋 Your Week 1 check-in will arrive on Day 7\n` +
        `💪 Let's crush this together!`;

    await sendWhatsApp({
      phone: client.phone,
      templateName: `onboard_${programKey}`,
      bodyValues: [body],
    });

    if (programKey === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://fitnessbymaddy.com';
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch (e) {
        console.error('Initial program generation failed:', e.message);
      }
    }

    return res.json({ action: 'converted', client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function mapExlyProgram(exlyProgram) {
  if (!exlyProgram) return '6wk_gym';
  const lower = exlyProgram.toLowerCase();
  if (lower.includes('12') || lower.includes('flagship') || lower.includes('custom')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40') || lower.includes('plus')) return '40plus';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('zoom') && lower.includes('pack')) return 'zoom_pack';
  return '6wk_gym';
}
