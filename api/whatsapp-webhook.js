const {
  supabaseFetch,
  getLead,
  insertMessage,
  maskPhone,
  isEscalation,
  detectLanguage,
  corsHeaders,
  handleCors,
} = require('./_lib/supabase');

const STOP_KEYWORDS = ['stop', 'unsubscribe', 'opt out', 'optout', 'cancel'];

const PROGRAM_ROUTES = [
  { keywords: ['fat loss', 'weight', 'shred'], program: '6wk', templateSuffix: '6wk_program' },
  { keywords: ['pcos', 'hormonal'], program: 'pcos', templateSuffix: 'pcos_program' },
  { keywords: ['40', 'menopause', 'joints'], program: '40plus', templateSuffix: '40plus_program' },
  { keywords: ['custom', '12 week', 'serious'], program: '12wk_flagship', templateSuffix: '12wk_program' },
  { keywords: ['trial', 'zoom', 'not sure'], program: 'trial', templateSuffix: 'trial_offer' },
];

/**
 * POST /api/whatsapp-webhook - Incoming WhatsApp messages from AiSensy
 * GET /api/whatsapp-webhook - Webhook verification
 */
export default async function handler(req, res) {
  if (handleCors(req, res)) return;

  Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));

  // GET handler for webhook verification
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'ok', message: 'Webhook active' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const payload = req.body;

    // Extract message details from AiSensy webhook payload
    const phone = payload.phone || payload.from || payload.sender;
    const name = payload.name || payload.pushName || payload.userName || '';
    const messageBody = payload.message || payload.text || payload.body || '';

    if (!phone) {
      return res.status(400).json({ error: 'No phone number in payload' });
    }

    console.log(`Incoming message from ${maskPhone(phone)}: ${messageBody.substring(0, 50)}...`);

    // Check if lead exists
    let lead = await getLead(phone);

    if (!lead) {
      // Insert new lead
      const newLead = await supabaseFetch('/leads', {
        method: 'POST',
        body: {
          phone,
          name: name || null,
          status: 'new',
          source: 'whatsapp',
          created_at: new Date().toISOString(),
        },
      });
      lead = newLead && newLead.length > 0 ? newLead[0] : { phone, status: 'new' };
      console.log(`New lead created: ${maskPhone(phone)}`);
    }

    // Log incoming message
    await insertMessage(phone, 'in', messageBody, null);

    const lowerMessage = messageBody.toLowerCase().trim();
    const lang = detectLanguage(phone);

    // Check for STOP/unsubscribe
    if (STOP_KEYWORDS.some(kw => lowerMessage.includes(kw))) {
      await supabaseFetch(`/leads?phone=eq.${encodeURIComponent(phone)}`, {
        method: 'PATCH',
        body: { status: 'dropped', dropped_reason: 'unsubscribed', updated_at: new Date().toISOString() },
      });

      const stopMsg = lang === 'hinglish'
        ? 'Aapko successfully unsubscribe kar diya gaya hai. Agar future mein help chahiye toh message kar dijiye.'
        : 'You have been unsubscribed. If you need help in the future, just message us.';

      await sendWhatsApp(phone, stopMsg);
      return res.status(200).json({ action: 'unsubscribed' });
    }

    // Check for escalation keywords
    if (isEscalation(messageBody)) {
      // Notify Maddy
      const escalationMsg = `ESCALATION from ${maskPhone(phone)} (${name}):\n"${messageBody}"`;
      await sendWhatsApp(process.env.MADDY_PHONE, escalationMsg);

      const ackMsg = lang === 'hinglish'
        ? 'Main aapki baat Maddy tak pahuncha rahi hoon. Woh jaldi se aapse connect karengi.'
        : 'I\'m escalating this to Maddy. She will connect with you shortly.';

      await sendWhatsApp(phone, ackMsg);
      return res.status(200).json({ action: 'escalated' });
    }

    // Route based on keywords for program qualification
    let matched = false;
    for (const route of PROGRAM_ROUTES) {
      if (route.keywords.some(kw => lowerMessage.includes(kw))) {
        matched = true;

        // Update lead with interested program
        await supabaseFetch(`/leads?phone=eq.${encodeURIComponent(phone)}`, {
          method: 'PATCH',
          body: {
            interested_program: route.program,
            status: 'qualified',
            updated_at: new Date().toISOString(),
          },
        });

        // Send program-specific response
        await sendWhatsApp(phone, null, `program_info_${route.templateSuffix}`, [name || 'there']);
        break;
      }
    }

    // If no keyword match, send a general acknowledgment
    if (!matched) {
      const generalMsg = lang === 'hinglish'
        ? `Hi ${name || 'there'}! FitnessByMaddy mein welcome hai. Aap kya achieve karna chahte hain? Fat loss, PCOS management, ya kuch aur?`
        : `Hi ${name || 'there'}! Welcome to FitnessByMaddy. What are you looking to achieve? Fat loss, PCOS management, or something else?`;

      await sendWhatsApp(phone, generalMsg);
    }

    return res.status(200).json({ success: true, action: matched ? 'program_routed' : 'general_response' });
  } catch (error) {
    console.error('whatsapp-webhook error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Helper to call our own send-whatsapp endpoint
 */
async function sendWhatsApp(phone, message, templateName = null, templateParams = null) {
  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'http://localhost:3000';

  const body = { phone };
  if (message) body.message = message;
  if (templateName) body.template_name = templateName;
  if (templateParams) body.template_params = templateParams;

  try {
    await fetch(`${baseUrl}/api/send-whatsapp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error(`Failed to send WhatsApp to ${maskPhone(phone)}:`, err.message);
  }
}
