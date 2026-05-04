const { supabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { detectMarket } = require('../lib/market');
const { needsEscalation, isOptOut, notifyMaddy } = require('../lib/escalation');

const PROGRAM_ROUTES = [
  { pattern: /fat\s*loss|weight|shred/i, program: '6wk_gym', name: '6-Week Burn & Build', price: '$45' },
  { pattern: /pcos|hormonal/i, program: 'pcos', name: 'PCOS Warrior', price: '$45' },
  { pattern: /40|menopause|joints/i, program: '40plus', name: '40+ Strong', price: '$50' },
  { pattern: /custom|12\s*week|serious/i, program: '12wk', name: '12-Week Flagship', price: '$200' },
  { pattern: /trial|zoom|not\s*sure/i, program: 'zoom_trial', name: 'Zoom Trial', price: '$20' }
];

function routeProgram(text) {
  if (!text) return null;
  for (const r of PROGRAM_ROUTES) {
    if (r.pattern.test(text)) return r;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === process.env.WA_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body;
    let phone, text, senderName;

    if (body.entry) {
      const change = body.entry?.[0]?.changes?.[0]?.value;
      const msg = change?.messages?.[0];
      if (!msg) return res.status(200).json({ ok: true });
      phone = msg.from;
      text = msg.text?.body || '';
      senderName = change?.contacts?.[0]?.profile?.name || null;
    } else if (body.mobile || body.phone) {
      phone = body.mobile || body.phone;
      text = body.text || body.message || '';
      senderName = body.name || null;
    } else {
      return res.status(200).json({ ok: true });
    }

    if (!phone) return res.status(200).json({ ok: true });
    phone = phone.replace(/[^0-9]/g, '');

    await supabase.from('messages').insert({
      phone, direction: 'in', body: text, status: 'received'
    });

    if (isOptOut(text)) {
      await supabase.from('leads').upsert(
        { phone, status: 'dropped', last_msg_at: new Date().toISOString() },
        { onConflict: 'phone' }
      );
      return res.status(200).json({ ok: true, action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await notifyMaddy('Escalation keyword in message', phone, text.slice(0, 200));
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      const market = detectMarket(phone);
      await supabase.from('leads').insert({
        phone,
        name: senderName,
        source: 'whatsapp',
        status: 'new',
        first_msg: text,
        last_msg_at: new Date().toISOString(),
        market
      });

      const template = market === 'IN' ? 'welcome_v1_hinglish' : 'welcome_v1_english';
      await sendTemplate(phone, template, [senderName || 'there']);
      return res.status(200).json({ ok: true, action: 'new_lead' });
    }

    await supabase.from('leads').update({
      last_msg_at: new Date().toISOString(),
      name: senderName || existingLead.name
    }).eq('phone', phone);

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ ok: true, action: 'dropped_ignored' });
    }

    if (existingLead.status === 'new') {
      const route = routeProgram(text);
      if (route) {
        await supabase.from('leads').update({
          status: 'qualified',
          program_interest: route.program
        }).eq('phone', phone);

        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://fitnessbymaddy.com';

        await sendTemplate(phone, `program_info_${route.program}`, [
          senderName || existingLead.name || 'there',
          route.name,
          route.price,
          `${baseUrl}/intake.html?lead=${existingLead.id}`
        ]);

        return res.status(200).json({ ok: true, action: 'qualified', program: route.program });
      }

      // No keyword match — schedule 2hr nudge via timeout
      // (Vercel doesn't support delayed execution natively;
      //  the cron/nudge-dropped handles re-engagement)
    }

    return res.status(200).json({ ok: true, action: 'message_logged' });

  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(200).json({ ok: true });
  }
};
