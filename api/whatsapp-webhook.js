const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp, notifyMaddy } = require('./_lib/whatsapp');
const {
  detectMarket,
  maskPhone,
  detectProgram,
  needsEscalation,
  isOptOut,
  PROGRAM_LABELS,
  PROGRAM_PRICES,
  corsHeaders,
} = require('./_lib/utils');

module.exports = async function handler(req, res) {
  if (corsHeaders(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = req.body;
    const phone = body.mobile || body.senderMobile || body.from;
    const text = body.text || body.message || body.body || '';
    const senderName = body.senderName || body.name || null;

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    const db = getSupabase();

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: text,
    });

    if (isOptOut(text)) {
      await db.from('leads').update({ status: 'dropped', opted_out: true }).eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    const escalationKeyword = needsEscalation(text);
    if (escalationKeyword) {
      await db.from('escalations').insert({
        phone,
        reason: escalationKeyword,
        message_body: text,
      });
      await notifyMaddy(
        `Keyword "${escalationKeyword}" detected`,
        `From: ${maskPhone(phone)}\nMsg: ${text.slice(0, 200)}`
      );
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (existingLead?.opted_out) {
      return res.status(200).json({ action: 'opted_out_ignored' });
    }

    if (!existingLead) {
      const market = detectMarket(phone);
      const { data: newLead } = await db
        .from('leads')
        .insert({
          phone,
          name: senderName,
          first_msg: text,
          market,
          status: 'new',
        })
        .select()
        .single();

      const greeting =
        market === 'IN'
          ? "Hi! Maddy's team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"
          : "Hi! Maddy's team here 👋 What's your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?";

      await sendWhatsApp({
        phone,
        templateName: 'welcome_v1',
        templateParams: {
          name: senderName || 'there',
          params: [senderName || 'there'],
        },
      });

      return res.status(200).json({ action: 'new_lead', id: newLead.id });
    }

    await db
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('phone', phone);

    if (existingLead.status === 'new' || existingLead.status === 'qualified') {
      const program = detectProgram(text);
      if (program) {
        await db
          .from('leads')
          .update({ status: 'qualified', program_interest: program })
          .eq('phone', phone);

        const market = existingLead.market || 'IN';
        const label = PROGRAM_LABELS[program];
        const price = PROGRAM_PRICES[program];
        const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
        const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

        const msg =
          market === 'IN'
            ? `Great choice! 💪 ${label} ($${price}) perfect rahega tere liye.\n\n👉 Checkout: ${checkoutUrl}\n📋 Intake form: ${intakeUrl}\n\nPayment ke baad turant access milega!`
            : `Great choice! 💪 ${label} ($${price}) is perfect for you.\n\n👉 Checkout: ${checkoutUrl}\n📋 Intake form: ${intakeUrl}\n\nYou'll get instant access after payment!`;

        await sendWhatsApp({ phone, message: msg });

        return res.status(200).json({ action: 'qualified', program });
      }
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
