const {
  supabaseFetch,
  insertMessage,
  maskPhone,
  corsHeaders,
  handleCors,
} = require('./_lib/supabase');

const AISENSY_API_URL = 'https://backend.aisensy.com/campaign/t1/api/v2';

/**
 * POST /api/send-whatsapp
 * Internal use: sends a WhatsApp message via AiSensy
 * Body: { phone, message, template_name, template_params }
 */
export default async function handler(req, res) {
  if (handleCors(req, res)) return;

  Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { phone, message, template_name, template_params } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'phone is required' });
    }

    if (!message && !template_name) {
      return res.status(400).json({ error: 'message or template_name is required' });
    }

    // Rate limiting: check if last outbound was < 2hrs ago
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const recentMessages = await supabaseFetch(
      `/messages?phone=eq.${encodeURIComponent(phone)}&direction=eq.out&created_at=gte.${encodeURIComponent(twoHoursAgo)}&order=created_at.desc&limit=1`
    );

    if (recentMessages && recentMessages.length > 0) {
      // Check if phone belongs to an active client (exempt from rate limiting)
      const clients = await supabaseFetch(
        `/clients?phone=eq.${encodeURIComponent(phone)}&status=eq.active&limit=1`
      );

      if (!clients || clients.length === 0) {
        console.log(`Rate limited: ${maskPhone(phone)} - last message within 2hrs`);
        return res.status(429).json({ error: 'Rate limited. Max 1 outbound per lead per 2 hours.' });
      }
    }

    // Build AiSensy payload
    let payload;

    if (template_name) {
      // Template message
      payload = {
        apiKey: process.env.AISENSY_API_KEY,
        campaignName: template_name,
        destination: phone.replace('+', ''),
        userName: 'FitnessByMaddy',
        templateParams: template_params || [],
      };
    } else {
      // Session message
      payload = {
        apiKey: process.env.AISENSY_API_KEY,
        campaignName: 'session_message',
        destination: phone.replace('+', ''),
        userName: 'FitnessByMaddy',
        message: message,
      };
    }

    // Send via AiSensy
    const aiSensyRes = await fetch(AISENSY_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const aiSensyData = await aiSensyRes.json();

    if (!aiSensyRes.ok) {
      console.error(`AiSensy error for ${maskPhone(phone)}:`, aiSensyData);
      return res.status(502).json({ error: 'Failed to send WhatsApp message', details: aiSensyData });
    }

    // Log to messages table
    await insertMessage(phone, 'out', message || `[template: ${template_name}]`, template_name);

    console.log(`WhatsApp sent to ${maskPhone(phone)} via ${template_name || 'session'}`);

    return res.status(200).json({ success: true, messageId: aiSensyData.messageId || null });
  } catch (error) {
    console.error('send-whatsapp error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
