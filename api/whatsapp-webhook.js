const { supabase } = require('./_lib/supabase');
const { canSendMessage, sendTemplate, sendText, logIncoming } = require('./_lib/whatsapp');
const {
  maskPhone, detectMarket, isHinglishMarket, needsEscalation,
  detectProgram, isOptOut, cors, parseBody, PROGRAM_NAMES,
} = require('./_lib/utils');

const MADDY_PHONE = process.env.MADDY_PHONE || '+917082478374';

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = await parseBody(req);
    const phone = body.phone || body.sender || body.from;
    const text = body.text || body.message || body.body || '';

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    await logIncoming(phone, text);

    if (isOptOut(text)) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await sendText(MADDY_PHONE,
        `ESCALATION from ${maskPhone(phone)}: "${text.slice(0, 200)}"`
      );
    }

    const { data: existing } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existing) {
      const market = detectMarket(phone);
      const { data: lead } = await supabase.from('leads').insert({
        phone,
        name: body.name || null,
        source: 'whatsapp',
        status: 'new',
        first_msg: text,
        market,
      }).select().single();

      if (isHinglishMarket(market)) {
        await sendTemplate(phone, 'welcome_v1', [body.name || 'there']);
      } else {
        await sendTemplate(phone, 'welcome_v1_en', [body.name || 'there']);
      }

      return res.json({ action: 'new_lead', lead_id: lead.id });
    }

    if (existing.status === 'dropped') {
      return res.json({ action: 'ignored_dropped' });
    }

    await supabase.from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existing.id);

    if (existing.status === 'new') {
      const program = detectProgram(text);
      if (program) {
        await supabase.from('leads')
          .update({ status: 'qualified', program_interest: program })
          .eq('id', existing.id);

        const market = existing.market;
        const programName = PROGRAM_NAMES[program];

        if (isHinglishMarket(market)) {
          await sendTemplate(phone, 'program_matched', [
            existing.name || 'there',
            programName,
            `https://fitnessbymaddyy.exlyapp.com/checkout/${existing.id}`,
            `https://fitnessbymaddy.com/intake?lead=${existing.id}`,
          ]);
        } else {
          await sendTemplate(phone, 'program_matched_en', [
            existing.name || 'there',
            programName,
            `https://fitnessbymaddyy.exlyapp.com/checkout/${existing.id}`,
            `https://fitnessbymaddy.com/intake?lead=${existing.id}`,
          ]);
        }

        return res.json({ action: 'qualified', program });
      }
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('phone', phone)
      .eq('status', 'active')
      .single();

    if (client) {
      return res.json({ action: 'active_client_msg', client_id: client.id });
    }

    return res.json({ action: 'message_logged' });
  } catch (err) {
    console.error('whatsapp-webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
