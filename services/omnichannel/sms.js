// SMS via Twilio if creds set, else logs + returns ok-stub so journeys don't break.
async function sendSms(to, body) {
  if (!to) throw new Error('to required');
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER) {
    try {
      const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      const r = await twilio.messages.create({ from: process.env.TWILIO_FROM_NUMBER, to, body });
      return { ok: true, sid: r.sid };
    } catch (e) {
      throw new Error('twilio failed: ' + e.message);
    }
  }
  console.log('[sms-stub] →', to, '·', String(body).slice(0, 80));
  return { ok: true, stub: true };
}

module.exports = { sendSms };
