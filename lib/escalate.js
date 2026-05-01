const { Resend } = require("resend");
const { sendText } = require("./whatsapp");

async function notifyMaddy(reason, details) {
  const timestamp = new Date().toISOString();
  const whatsappBody = [
    `ESCALATION: ${reason}`,
    `Time: ${timestamp}`,
    details.phone ? `Client: ${details.phone}` : null,
    details.message ? `Message: ${details.message}` : null,
    details.context || null,
  ]
    .filter(Boolean)
    .join("\n");

  const results = { whatsapp: null, email: null };

  try {
    results.whatsapp = await sendText(process.env.MADDY_PHONE, whatsappBody);
  } catch (err) {
    console.error("Escalation WhatsApp failed:", err.message);
    results.whatsapp = { success: false, error: err.message };
  }

  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const emailResult = await resend.emails.send({
      from: "support@fitnessbymaddy.com",
      to: process.env.MADDY_EMAIL,
      subject: `Escalation: ${reason}`,
      text: whatsappBody,
    });
    results.email = { success: true, id: emailResult.data?.id };
  } catch (err) {
    console.error("Escalation email failed:", err.message);
    results.email = { success: false, error: err.message };
  }

  return results;
}

module.exports = { notifyMaddy };
