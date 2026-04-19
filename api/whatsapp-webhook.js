const { supabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { escalateToMaddy } = require('../lib/escalation');
const {
  detectMarket, detectProgram, needsEscalation, isOptOut,
  maskPhone, jsonResponse, handleCors, PROGRAM_NAMES
} = require('../lib/utils');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return jsonResponse(res, { error: 'Method not allowed' }, 405);

  try {
    const payload = req.body;
    const phone = payload.mobile || payload.from || payload.senderMobile;
    const text = payload.text || payload.message || payload.body || '';
    const name = payload.senderName || payload.name || null;

    if (!phone) return jsonResponse(res, { error: 'No phone number' }, 400);

    await supabase.from('messages').insert({
      phone, direction: 'in', body: text, template_name: null
    });

    if (isOptOut(text)) {
      await supabase
        .from('leads')
        .update({ status: 'dropped', last_msg_at: new Date().toISOString() })
        .eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return jsonResponse(res, { action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await escalateToMaddy('Sensitive keyword detected in WhatsApp message', {
        leadPhone: phone,
        name: name || 'Unknown',
        details: `Message: "${text.substring(0, 200)}"`
      });
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!existingLead) {
      const market = detectMarket(phone);
      const { data: newLead } = await supabase.from('leads').insert({
        phone, name, source: 'whatsapp', status: 'new',
        first_msg: text, last_msg_at: new Date().toISOString(),
        market
      }).select().single();

      const welcomeParams = market === 'IN'
        ? ['Hi! Maddy\'s team here. Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?']
        : ['Hi! Maddy\'s team here. What\'s your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?'];

      await sendWhatsApp(phone, 'welcome_v1', welcomeParams);
      console.log(`New lead: ${maskPhone(phone)} market=${market}`);
      return jsonResponse(res, { action: 'new_lead', id: newLead?.id });
    }

    await supabase
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    if (existingLead.status === 'dropped') {
      return jsonResponse(res, { action: 'lead_dropped', note: 'No further messages' });
    }

    const program = detectProgram(text);
    if (program && existingLead.status === 'new') {
      await supabase.from('leads').update({
        status: 'qualified',
        program_interest: program
      }).eq('id', existingLead.id);

      const market = existingLead.market || 'GLOBAL';
      const programName = PROGRAM_NAMES[program] || program;
      const siteUrl = 'https://fitnessbymaddy.com';
      const intakeUrl = `${siteUrl}/intake?lead=${existingLead.id}`;

      const replyParams = market === 'IN'
        ? [`Great choice! ${programName} ke liye yeh form fill karo: ${intakeUrl}`]
        : [`Great choice! Fill out this form to get started with ${programName}: ${intakeUrl}`];

      await sendWhatsApp(phone, 'program_qualified', replyParams);
      console.log(`Lead qualified: ${maskPhone(phone)} program=${program}`);
      return jsonResponse(res, { action: 'qualified', program });
    }

    return jsonResponse(res, { action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return jsonResponse(res, { error: 'Internal error' }, 500);
  }
};
