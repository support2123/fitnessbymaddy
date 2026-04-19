const { sendTemplate } = require("./whatsapp");
const { maskPhone } = require("./utils");
const { Resend } = require("resend");

const MADDY_PHONE = "+917082478374";

async function escalateToMaddy(reason, details) {
  const safeDetails = { ...details };
  if (safeDetails.phone) safeDetails.phone = maskPhone(safeDetails.phone);

  try {
    await sendTemplate(MADDY_PHONE, "escalation_alert", [
      reason,
      JSON.stringify(safeDetails).slice(0, 500),
    ]);
  } catch (err) {
    console.error("WhatsApp escalation failed:", err.message);
  }

  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: "FitnessByMaddy Bot <support@fitnessbymaddy.com>",
      to: "support@fitnessbymaddy.com",
      subject: `[ESCALATION] ${reason}`,
      text: `Escalation: ${reason}\n\nDetails:\n${JSON.stringify(safeDetails, null, 2)}`,
    });
  } catch (err) {
    console.error("Email escalation failed:", err.message);
  }
}

module.exports = { escalateToMaddy };
