const { getClient } = require('../lib/supabase');
const { sendTextMessage } = require('../lib/whatsapp');
const { logMessage, notifyMaddy } = require('../lib/escalation');
const { maskPhone, PROGRAM_NAMES } = require('../lib/utils');
const crypto = require('crypto');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const db = getClient();

  try {
    const secret = process.env.EXLY_WEBHOOK_SECRET;
    if (secret) {
      const signature = req.headers['x-exly-signature'] || '';
      const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
      const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
      if (signature && signature !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const {
      phone, email, name, amount, checkout_id, product_name,
    } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone' });
    }

    const cleaned = phone.replace(/\D/g, '');

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', cleaned)
      .single();

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const program = lead?.program_interest || detectProgramFromProduct(product_name);
    const programWeeks = program === '12wk' ? 12 : program?.startsWith('6wk') ? 6 : 8;
    const startDate = new Date();
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + programWeeks * 7);

    const { data: client, error } = await db.from('clients').insert({
      lead_id: lead?.id || null,
      phone: cleaned,
      name: name || lead?.name || null,
      email: email || null,
      program,
      program_started_at: startDate.toISOString(),
      program_ends_at: endDate.toISOString(),
      paid_amount: amount || null,
      checkout_id: checkout_id || null,
      status: 'active',
    }).select().single();

    if (error) {
      console.error('Client insert error:', error.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    const folderPath = `clients/${client.id}`;
    await db.storage.from('programs').upload(`${folderPath}/.keep`, new Blob(['']));
    await db.from('clients').update({ folder_url: folderPath }).eq('id', client.id);

    const programName = PROGRAM_NAMES[program] || 'your program';
    const welcomeMsg = lead?.market === 'IN'
      ? `🎉 Welcome aboard! Aapka ${programName} officially start ho gaya hai!\n\nAapko har week ek check-in form milega. Pehla form Day 7 pe aayega.\n\nKoi bhi question ho toh yahan message karo. Let's crush it! 💪`
      : `🎉 Welcome aboard! Your ${programName} has officially started!\n\nYou'll receive a weekly check-in form. Your first one arrives on Day 7.\n\nMessage us here anytime with questions. Let's crush it! 💪`;

    await sendTextMessage(cleaned, welcomeMsg);
    await logMessage(db, cleaned, 'out', welcomeMsg, `onboard_${program}`);

    if (program === '12wk') {
      try {
        const origin = `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch (genErr) {
        console.error('Week-1 program generation failed:', genErr.message);
      }
    }

    return res.status(200).json({ success: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function detectProgramFromProduct(productName) {
  if (!productName) return '6wk_gym';
  const lower = productName.toLowerCase();
  if (lower.includes('12') || lower.includes('custom')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40')) return '40plus';
  if (lower.includes('trial') || lower.includes('zoom')) return 'zoom_trial';
  if (lower.includes('home')) return '6wk_home';
  return '6wk_gym';
}
