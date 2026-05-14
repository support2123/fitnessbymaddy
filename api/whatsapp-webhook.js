import supabase from '../lib/supabase.js';
import { sendTemplate } from '../lib/whatsapp.js';
import { logMessage } from '../lib/whatsapp.js';
import {
  detectMarket, isHinglish, needsEscalation, isOptOut,
  classifyIntent, programLabel, maskPhone, jsonResponse,
} from '../lib/utils.js';

const MADDY_PHONE = process.env.MADDY_PHONE || '917082478374';
const SITE = 'https://www.fitnessbymaddy.com';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return jsonResponse(res, 405, { error: 'Method not allowed' });

  try {
    const payload = req.body;
    const phone = payload.senderPhone || payload.from || payload.waId;
    const text = payload.text || payload.body || payload.message?.text || '';
    const name = payload.senderName || payload.pushName || null;

    if (!phone) return jsonResponse(res, 400, { error: 'Missing phone' });

    await logMessage(phone, 'in', text, null);

    if (isOptOut(text)) {
      await supabase
        .from('leads')
        .update({ status: 'dropped', last_msg_at: new Date().toISOString() })
        .eq('phone', phone);
      return jsonResponse(res, 200, { action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await notifyMaddy(phone, name, text);
      return jsonResponse(res, 200, { action: 'escalated' });
    }

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id, status')
      .eq('phone', phone)
      .eq('status', 'active')
      .maybeSingle();

    if (existingClient) {
      if (needsEscalation(text)) {
        await notifyMaddy(phone, name, text);
      }
      return jsonResponse(res, 200, { action: 'active_client_message_logged' });
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .maybeSingle();

    if (existingLead) {
      await supabase
        .from('leads')
        .update({ last_msg_at: new Date().toISOString(), first_msg: existingLead.first_msg || text })
        .eq('id', existingLead.id);

      if (existingLead.status === 'dropped') {
        return jsonResponse(res, 200, { action: 'dropped_lead_ignored' });
      }

      const program = classifyIntent(text);
      if (program) {
        await supabase
          .from('leads')
          .update({ status: 'qualified', program_interest: program })
          .eq('id', existingLead.id);

        await sendQualifiedReply(phone, program, existingLead.market, existingLead.id);
        return jsonResponse(res, 200, { action: 'qualified', program });
      }

      return jsonResponse(res, 200, { action: 'existing_lead_updated' });
    }

    const market = detectMarket(phone);
    const { data: newLead } = await supabase
      .from('leads')
      .insert({
        phone,
        name,
        source: 'whatsapp',
        status: 'new',
        first_msg: text,
        last_msg_at: new Date().toISOString(),
        market,
      })
      .select()
      .single();

    const program = classifyIntent(text);
    if (program) {
      await supabase
        .from('leads')
        .update({ status: 'qualified', program_interest: program })
        .eq('id', newLead.id);

      await sendQualifiedReply(phone, program, market, newLead.id);
      return jsonResponse(res, 200, { action: 'new_lead_qualified', program });
    }

    await sendWelcome(phone, market);
    return jsonResponse(res, 200, { action: 'new_lead_welcomed' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return jsonResponse(res, 500, { error: 'Internal error' });
  }
}

async function sendWelcome(phone, market) {
  if (isHinglish(market)) {
    await sendTemplate(phone, 'welcome_v1', [
      "Hi! Maddy's team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?",
    ]);
  } else {
    await sendTemplate(phone, 'welcome_v1', [
      "Hi! Maddy's team here 👋 What's your goal — fat loss, PCOS, strength, or 40+ fitness? Or would you like to try a trial first?",
    ]);
  }
}

async function sendQualifiedReply(phone, program, market, leadId) {
  const label = programLabel(program);
  const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${program}`;
  const intakeUrl = `${SITE}/intake.html?lead=${leadId}`;

  const hinglish = isHinglish(market);
  const msg = hinglish
    ? `Great choice! 🔥 ${label} aapke liye perfect hai.\n\n` +
      `✅ Checkout: ${checkoutUrl}\n` +
      `📋 Intake form bhi fill karo: ${intakeUrl}\n\n` +
      `Payment ke baad turant access milega!`
    : `Great choice! 🔥 ${label} is perfect for you.\n\n` +
      `✅ Checkout: ${checkoutUrl}\n` +
      `📋 Please fill the intake form too: ${intakeUrl}\n\n` +
      `You'll get instant access after payment!`;

  await sendTemplate(phone, 'program_qualified', [msg]);
}

async function notifyMaddy(phone, name, text) {
  const masked = maskPhone(phone);
  await sendTemplate(MADDY_PHONE, 'escalation_alert', [
    `⚠️ ESCALATION\nFrom: ${name || 'Unknown'} (${masked})\nMessage: "${text.slice(0, 200)}"`,
  ]);
}
