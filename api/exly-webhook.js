const { supabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { maskPhone, isHinglish, PROGRAM_NAMES, PROGRAM_DURATIONS } = require('./_lib/helpers');
const crypto = require('crypto');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // Verify webhook signature if secret is set
    const secret = process.env.EXLY_WEBHOOK_SECRET;
    if (secret && req.headers['x-exly-signature']) {
      const sig = crypto.createHmac('sha256', secret)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (sig !== req.headers['x-exly-signature']) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const { phone, email, name, amount, checkout_id, product_name } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone number' });
    }

    console.log(`Purchase confirmed for ${maskPhone(phone)}: $${amount}`);

    // Find the lead
    const normalizedPhone = phone.startsWith('+') ? phone : '+' + phone;
    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', normalizedPhone)
      .single();

    if (!lead) {
      console.error(`No lead found for ${maskPhone(normalizedPhone)}`);
      return res.status(404).json({ error: 'Lead not found' });
    }

    const program = lead.program_interest || inferProgram(amount, product_name);
    const duration = PROGRAM_DURATIONS[program] || 42;
    const programEnd = new Date();
    programEnd.setDate(programEnd.getDate() + duration);

    // Create client
    const { data: client, error: clientErr } = await supabase.from('clients').insert({
      lead_id: lead.id,
      phone: normalizedPhone,
      name: name || lead.name,
      email: email || null,
      program,
      program_started_at: new Date().toISOString(),
      program_ends_at: programEnd.toISOString(),
      paid_amount: Math.round(amount * 100),
      checkout_id: checkout_id || null,
      folder_url: null,
      status: 'active'
    }).select().single();

    if (clientErr) {
      console.error('Client creation error:', clientErr.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    // Update lead status
    await supabase.from('leads')
      .update({ status: 'converted' })
      .eq('id', lead.id);

    // Create storage folder
    const folderPath = `clients/${client.id}/`;
    await supabase.storage.from('client-files').upload(
      `${folderPath}.keep`,
      new Uint8Array(0),
      { contentType: 'application/octet-stream', upsert: true }
    );
    await supabase.from('clients')
      .update({ folder_url: folderPath })
      .eq('id', client.id);

    // Send welcome message
    const market = lead.market || 'GLOBAL';
    const programName = PROGRAM_NAMES[program] || program;
    const welcomeMsg = isHinglish(market)
      ? `Welcome to ${programName}! 🎉\n\nMaddy aur team bohut excited hai aapke saath kaam karne ke liye. Aapka program start ho gaya hai!\n\nDay 7 pe aapko check-in form milega — honest answers dena taaki program aapke liye best bane.`
      : `Welcome to ${programName}! 🎉\n\nMaddy and the team are excited to work with you. Your program has officially started!\n\nYou'll receive a check-in form on Day 7 — be honest so we can optimize your program.`;

    await sendWhatsApp({ phone: normalizedPhone, body: welcomeMsg, templateName: `onboard_${program}` });

    // If 12-week program, trigger immediate Week 1 generation
    if (program === '12wk') {
      try {
        const baseUrl = `https://${req.headers.host}`;
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (e) {
        console.error('Week 1 generation trigger failed:', e.message);
      }
    }

    return res.status(200).json({ success: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function inferProgram(amount, productName) {
  if (amount <= 25) return 'zoom_trial';
  if (amount <= 50) return 'pcos';
  if (amount <= 55) return '40plus';
  if (amount <= 100) return '6wk_gym';
  return '12wk';
}
