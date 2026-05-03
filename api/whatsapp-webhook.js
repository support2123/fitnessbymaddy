const { getSupabase } = require('./_lib/supabase');
const { detectMarket, isHinglish, maskPhone } = require('./_lib/market');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { checkAndEscalate } = require('./_lib/escalation');
const { qualifyLead, getCheckoutUrl } = require('./_lib/qualify');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const phone = payload.mobile || payload.from || payload.senderMobile;
    const text = payload.text || payload.message || payload.body || '';
    const name = payload.senderName || payload.name || null;

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    const db = getSupabase();

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: text,
    });

    const lower = (text || '').toLowerCase().trim();
    if (lower === 'stop' || lower === 'unsubscribe') {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.json({ action: 'opted_out' });
    }

    const escalated = await checkAndEscalate(phone, text);

    const { data: existing } = await db
      .from('leads')
      .select('id, status, created_at')
      .eq('phone', phone)
      .single();

    if (existing) {
      await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existing.id);

      if (existing.status === 'dropped') {
        return res.json({ action: 'ignored_dropped' });
      }

      if (existing.status === 'new') {
        const match = qualifyLead(text);
        if (match) {
          await db.from('leads').update({
            status: 'qualified',
            program_interest: match.program,
          }).eq('id', existing.id);

          const market = detectMarket(phone);
          const hinglish = isHinglish(market);
          const checkoutUrl = getCheckoutUrl(match.program);
          const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${existing.id}`;

          await sendWhatsApp({
            phone,
            templateName: 'program_recommendation',
            bodyValues: [
              name || 'there',
              match.label,
              checkoutUrl,
              intakeUrl,
            ],
          });

          return res.json({ action: 'qualified', program: match.program });
        }
      }

      if (!escalated) {
        return res.json({ action: 'existing_lead', id: existing.id });
      }
      return res.json({ action: 'escalated' });
    }

    const market = detectMarket(phone);

    const { data: lead, error: insertErr } = await db.from('leads').insert({
      phone,
      name,
      source: 'whatsapp',
      status: 'new',
      first_msg: text,
      last_msg_at: new Date().toISOString(),
      market,
    }).select('id').single();

    if (insertErr) {
      console.error(`Lead insert failed for ${maskPhone(phone)}:`, insertErr);
      return res.status(500).json({ error: 'Database error' });
    }

    const hinglish = isHinglish(market);
    await sendWhatsApp({
      phone,
      templateName: 'welcome_v1',
      bodyValues: [name || 'there'],
    });

    const match = qualifyLead(text);
    if (match) {
      await db.from('leads').update({
        status: 'qualified',
        program_interest: match.program,
      }).eq('id', lead.id);

      const checkoutUrl = getCheckoutUrl(match.program);
      const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${lead.id}`;

      await sendWhatsApp({
        phone,
        templateName: 'program_recommendation',
        bodyValues: [name || 'there', match.label, checkoutUrl, intakeUrl],
      });
    }

    return res.json({ action: 'new_lead', id: lead.id, qualified: !!match });
  } catch (err) {
    console.error('Webhook error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};
