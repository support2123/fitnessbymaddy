const { getClient } = require('../lib/supabase');
const { sendTemplate, sendText, notifyMaddy } = require('../lib/whatsapp');
const { detectMarket, maskPhone } = require('../lib/market');
const { needsEscalation, needsOptOut } = require('../lib/escalation');

const PROGRAM_ROUTES = {
  'fat loss': '6wk_gym', 'weight loss': '6wk_gym', 'weight': '6wk_gym',
  'shred': '6wk_gym', 'slim': '6wk_gym', 'lean': '6wk_gym', 'burn': '6wk_gym',
  'pcos': 'pcos', 'hormonal': 'pcos', 'pcod': 'pcos',
  '40': '40plus', 'menopause': '40plus', 'joints': '40plus',
  'custom': '12wk', '12 week': '12wk', 'serious': '12wk', 'flagship': '12wk',
  'trial': 'zoom_trial', 'zoom': 'zoom_trial', 'not sure': 'zoom_trial', 'try': 'zoom_trial'
};

var PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build',
  '6wk_home': '6-Week Home Program',
  'pcos': 'PCOS Warrior',
  '40plus': '40+ Strong',
  '12wk': '12-Week Custom Flagship',
  'zoom_trial': '$20 Zoom Trial',
  'zoom_pack': 'Zoom Pack'
};

function matchProgram(text) {
  var lower = text.toLowerCase();
  var keys = Object.keys(PROGRAM_ROUTES);
  for (var i = 0; i < keys.length; i++) {
    if (lower.includes(keys[i])) return PROGRAM_ROUTES[keys[i]];
  }
  return null;
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
    var body = req.body;
    var phone, name, text;

    // Parse Meta Cloud API / AiSensy webhook format
    if (body.entry) {
      var change = body.entry[0] && body.entry[0].changes && body.entry[0].changes[0]
        && body.entry[0].changes[0].value;
      if (!change || !change.messages || !change.messages[0]) {
        return res.status(200).json({ ok: true });
      }
      var msg = change.messages[0];
      phone = '+' + msg.from;
      name = (change.contacts && change.contacts[0] && change.contacts[0].profile
        && change.contacts[0].profile.name) || '';
      text = (msg.text && msg.text.body) || '';
    } else if (body.phone && body.message) {
      phone = body.phone.startsWith('+') ? body.phone : '+' + body.phone;
      name = body.name || '';
      text = body.message;
    } else {
      return res.status(200).json({ ok: true });
    }

    var db = getClient();
    var market = detectMarket(phone);

    // Log incoming message
    await db.from('messages').insert({
      phone: phone, direction: 'in', body: text,
      sent_at: new Date().toISOString(), status: 'received'
    });

    // Check opt-out
    if (needsOptOut(text)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ ok: true, action: 'opted_out' });
    }

    // Check escalation triggers
    if (needsEscalation(text)) {
      await notifyMaddy('Escalation Required',
        'From: ' + maskPhone(phone) + '\nMessage: ' + text + '\nAction: Manual review needed');
    }

    // Check if existing lead
    var leadResult = await db.from('leads').select('*').eq('phone', phone).single();
    var existingLead = leadResult.data;

    if (!existingLead) {
      // FLOW A: New lead
      await db.from('leads').insert({
        phone: phone, name: name, source: 'whatsapp', status: 'new',
        first_msg: text, last_msg_at: new Date().toISOString(),
        market: market, created_at: new Date().toISOString()
      });

      await sendTemplate(phone, 'welcome_v1', [name || 'there']);
      return res.status(200).json({ ok: true, action: 'new_lead' });
    }

    // Update last message timestamp
    await db.from('leads').update({
      last_msg_at: new Date().toISOString()
    }).eq('id', existingLead.id);

    // FLOW B: Lead qualification
    if (existingLead.status === 'new' || existingLead.status === 'dropped') {
      var program = matchProgram(text);
      if (program) {
        await db.from('leads').update({
          status: 'qualified', program_interest: program
        }).eq('id', existingLead.id);

        var programName = PROGRAM_NAMES[program];
        var checkoutUrl = 'https://fitnessbymaddyy.exlyapp.com/checkout/' + existingLead.id;
        var intakeUrl = 'https://fitnessbymaddy.com/intake?lead=' + existingLead.id;

        var qualifyMsg = market === 'IN'
          ? 'Perfect! ' + programName + ' aapke liye best rahega \uD83D\uDCAA\n\nCheckout: ' + checkoutUrl + '\n\nYeh form bhi fill kardo: ' + intakeUrl
          : 'Perfect! ' + programName + ' would be great for you \uD83D\uDCAA\n\nCheckout: ' + checkoutUrl + '\n\nAlso fill this form: ' + intakeUrl;

        await sendText(phone, qualifyMsg);
        return res.status(200).json({ ok: true, action: 'qualified', program: program });
      }
    }

    // Check if active client
    var clientResult = await db.from('clients').select('*')
      .eq('phone', phone).eq('status', 'active').single();
    var activeClient = clientResult.data;

    if (activeClient) {
      if (needsEscalation(text)) {
        await notifyMaddy('Client Escalation',
          'Client: ' + maskPhone(phone) + ' (' + activeClient.name + ')\nProgram: ' + activeClient.program + '\nMessage: ' + text);
      }
      return res.status(200).json({ ok: true, action: 'client_message' });
    }

    return res.status(200).json({ ok: true, action: 'processed' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(200).json({ ok: true });
  }
};
