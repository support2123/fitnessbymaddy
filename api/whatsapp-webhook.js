import { getSupabase } from '../lib/supabase.js';
import { sendTemplate, logIncoming } from '../lib/whatsapp.js';
import { detectMarket, isHinglish } from '../lib/market.js';
import { needsEscalation, isOptOut, escalateToMaddy } from '../lib/escalation.js';
import { qualifyLead, getCheckoutUrl } from '../lib/qualify.js';
import { maskPhone } from '../lib/mask-phone.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const phone = payload.mobile || payload.from || payload.senderMobile;
    const message = payload.message || payload.text || payload.body || '';
    const name = payload.name || payload.senderName || null;

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    const db = getSupabase();
    const market = detectMarket(phone);
    const hinglish = isHinglish(market);

    await logIncoming(phone, message);

    if (isOptOut(message)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      await escalateToMaddy('Keyword trigger in message', phone, message);
    }

    const { data: existingClient } = await db
      .from('clients')
      .select('id, status')
      .eq('phone', phone)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();

    if (existingClient) {
      return res.status(200).json({ action: 'active_client', clientId: existingClient.id });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .maybeSingle();

    if (existingLead) {
      await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);

      if (existingLead.status === 'dropped') {
        return res.status(200).json({ action: 'dropped_lead' });
      }

      const qualification = qualifyLead(message);
      if (qualification) {
        await db.from('leads').update({
          status: 'qualified',
          program_interest: qualification.program,
        }).eq('id', existingLead.id);

        const checkoutUrl = getCheckoutUrl(qualification.program);
        const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

        const params = hinglish
          ? [existingLead.name || 'there', qualification.label, checkoutUrl, intakeUrl]
          : [existingLead.name || 'there', qualification.label, checkoutUrl, intakeUrl];

        await sendTemplate(phone, 'program_recommendation', params);

        return res.status(200).json({ action: 'qualified', program: qualification.program });
      }

      return res.status(200).json({ action: 'existing_lead' });
    }

    const { data: newLead } = await db.from('leads').insert({
      phone,
      name,
      source: 'whatsapp',
      status: 'new',
      first_msg: message,
      last_msg_at: new Date().toISOString(),
      market,
    }).select().single();

    const welcomeParams = hinglish
      ? [name || 'there']
      : [name || 'there'];

    await sendTemplate(phone, 'welcome_v1', welcomeParams);

    scheduleNudge(phone, newLead.id);

    return res.status(200).json({ action: 'new_lead', leadId: newLead.id });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

function scheduleNudge(phone, leadId) {
  setTimeout(async () => {
    try {
      const db = getSupabase();
      const { data: lead } = await db
        .from('leads')
        .select('status')
        .eq('id', leadId)
        .single();

      if (lead && lead.status === 'new') {
        const trialUrl = 'https://fitnessbymaddy.com/intake.html?program=zoom_trial';
        await sendTemplate(phone, 'nudge_trial', [trialUrl]);
      }
    } catch (err) {
      console.error('Nudge error:', err.message);
    }
  }, 2 * 60 * 60 * 1000); // 2 hours
}
