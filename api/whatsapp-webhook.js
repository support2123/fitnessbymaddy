import supabase from './_lib/supabase.js';
import { sendTemplate } from './_lib/whatsapp.js';
import {
  detectMarket, maskPhone, detectProgram,
  isEscalationTrigger, isOptOut, programLabel,
  jsonResponse, parseBody,
} from './_lib/helpers.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return jsonResponse(res, 405, { error: 'Method not allowed' });

  try {
    const body = await parseBody(req);

    const phone = body.mobile || body.senderMobile || body.from;
    const text = body.text || body.message || body.body || '';
    const senderName = body.senderName || body.name || null;

    if (!phone) return jsonResponse(res, 400, { error: 'No phone number' });

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: text,
      template_name: null,
    });

    if (isOptOut(text)) {
      await supabase
        .from('leads')
        .update({ status: 'dropped' })
        .eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return jsonResponse(res, 200, { action: 'opted_out' });
    }

    if (isEscalationTrigger(text)) {
      await sendTemplate(process.env.MADDY_PHONE || phone, 'escalation_alert', [
        maskPhone(phone), text.slice(0, 200),
      ]);
      console.log(`Escalation triggered: ${maskPhone(phone)}`);
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      const market = detectMarket(phone);

      const { data: newLead } = await supabase
        .from('leads')
        .insert({
          phone,
          name: senderName,
          source: 'whatsapp',
          status: 'new',
          first_msg: text,
          last_msg_at: new Date().toISOString(),
          market,
        })
        .select()
        .single();

      const welcomeTemplate = market === 'IN' ? 'welcome_v1_hi' : 'welcome_v1';
      await sendTemplate(phone, welcomeTemplate, [senderName || 'there']);

      console.log(`New lead: ${maskPhone(phone)} market=${market}`);
      return jsonResponse(res, 200, { action: 'new_lead', id: newLead?.id });
    }

    if (existingLead.status === 'dropped') {
      return jsonResponse(res, 200, { action: 'ignored_dropped' });
    }

    await supabase
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    if (existingLead.status === 'new') {
      const program = detectProgram(text);
      if (program) {
        await supabase
          .from('leads')
          .update({ status: 'qualified', program_interest: program })
          .eq('id', existingLead.id);

        const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
        const intakeUrl = `https://www.fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

        await sendTemplate(phone, 'program_checkout', [
          senderName || existingLead.name || 'there',
          programLabel(program),
          checkoutUrl,
          intakeUrl,
        ]);

        console.log(`Lead qualified: ${maskPhone(phone)} → ${program}`);
        return jsonResponse(res, 200, { action: 'qualified', program });
      }
    }

    return jsonResponse(res, 200, { action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return jsonResponse(res, 500, { error: 'Internal server error' });
  }
}
