const { getSupabase } = require('./_lib/supabase');
const { sendTemplate, checkRateLimit } = require('./_lib/whatsapp');
const { detectMarket } = require('./_lib/market');
const { checkEscalation, notifyMaddy } = require('./_lib/escalation');
const { maskPhone } = require('./_lib/mask');
const whatsapp = require('./_lib/whatsapp');

const PROGRAM_ROUTES = [
  { keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'fat', 'lose weight', 'slim', 'belly'], program: '6wk_gym', name: '6-Week Burn & Build', price: '$35' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'pcod', 'irregular period'], program: 'pcos', name: 'PCOS Warrior', price: '$45' },
  { keywords: ['40', 'menopause', 'joints', 'joint pain', 'over 40', '40+', 'forty'], program: '40plus', name: '40+ Strong', price: '$50' },
  { keywords: ['custom', '12 week', 'serious', 'flagship', 'full program', '12wk', 'personali'], program: '12wk', name: '12-Week Custom', price: '$200' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'unsure', 'demo'], program: 'zoom_trial', name: 'Zoom Trial', price: '$20' }
];

var OPT_OUT = ['stop', 'unsubscribe', 'cancel', 'opt out', 'optout'];

function matchProgram(msg) {
  var lower = msg.toLowerCase();
  for (var i = 0; i < PROGRAM_ROUTES.length; i++) {
    var route = PROGRAM_ROUTES[i];
    for (var j = 0; j < route.keywords.length; j++) {
      if (lower.includes(route.keywords[j])) return route;
    }
  }
  return null;
}

function parseMessage(body) {
  var phone, name, text;

  if (body.entry) {
    var change = body.entry[0] && body.entry[0].changes && body.entry[0].changes[0] && body.entry[0].changes[0].value;
    if (!change || !change.messages || !change.messages[0]) return null;
    var msg = change.messages[0];
    var contact = change.contacts && change.contacts[0];
    phone = msg.from;
    name = contact && contact.profile ? contact.profile.name : '';
    text = msg.text ? msg.text.body : '';
  } else if (body.mobile || body.phone || body.senderMobile) {
    phone = body.mobile || body.phone || body.senderMobile;
    name = body.name || body.senderName || '';
    text = body.message || body.text || body.messageText || '';
  } else {
    return null;
  }

  if (!phone) return null;
  phone = phone.replace(/[^0-9+]/g, '');
  if (!phone.startsWith('+')) phone = '+' + phone;

  return { phone: phone, name: name || '', text: text || '' };
}

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    var mode = req.query['hub.mode'];
    var token = req.query['hub.verify_token'];
    var challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === process.env.WA_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    var supabase = getSupabase();
    var parsed = parseMessage(req.body);
    if (!parsed) return res.status(200).json({ status: 'no_message' });

    var phone = parsed.phone;
    var name = parsed.name;
    var messageBody = parsed.text;

    await supabase.from('messages').insert({
      phone: phone,
      direction: 'in',
      body: messageBody,
      status: 'received'
    });

    var lower = messageBody.toLowerCase();

    if (OPT_OUT.some(function (kw) { return lower.includes(kw); })) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      await supabase.from('clients').update({ status: 'paused' }).eq('phone', phone);
      return res.status(200).json({ status: 'opted_out' });
    }

    var escalation = checkEscalation(messageBody);
    if (escalation) {
      await notifyMaddy(supabase, whatsapp, {
        type: 'message_escalation',
        summary: 'Triggers: ' + escalation.join(', ') + ' | Msg: ' + messageBody.slice(0, 100),
        phone_masked: maskPhone(phone)
      });
    }

    var clientRes = await supabase
      .from('clients')
      .select('*')
      .eq('phone', phone)
      .eq('status', 'active')
      .limit(1)
      .single();

    if (clientRes.data) {
      return res.status(200).json({ status: 'client_message_logged' });
    }

    var leadRes = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .limit(1)
      .single();

    var market = detectMarket(phone);

    if (!leadRes.data) {
      await supabase.from('leads').insert({
        phone: phone,
        name: name,
        source: 'whatsapp',
        status: 'new',
        market: market,
        first_msg: messageBody
      });

      await sendTemplate(phone, 'welcome_v1', [name || 'there']);
      return res.status(200).json({ status: 'new_lead_welcomed' });
    }

    var lead = leadRes.data;

    if (lead.status === 'dropped') {
      return res.status(200).json({ status: 'lead_dropped' });
    }

    var matched = matchProgram(messageBody);

    if (matched) {
      await supabase.from('leads')
        .update({
          status: 'qualified',
          program_interest: matched.program,
          last_msg_at: new Date().toISOString()
        })
        .eq('id', lead.id);

      var rateLimited = await checkRateLimit(phone);
      if (!rateLimited) {
        var checkoutUrl = 'https://fitnessbymaddyy.exlyapp.com/checkout/' + matched.program;
        var intakeUrl = 'https://fitnessbymaddy.com/intake?lead=' + lead.id;

        await sendTemplate(phone, 'program_match', [
          name || 'there',
          matched.name,
          matched.price,
          checkoutUrl
        ]);
      }

      return res.status(200).json({ status: 'lead_qualified', program: matched.program });
    }

    await supabase.from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', lead.id);

    return res.status(200).json({ status: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
