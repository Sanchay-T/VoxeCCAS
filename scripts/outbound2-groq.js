require('dotenv').config();
const twilio = require('twilio');

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const client = twilio(accountSid, authToken);

async function makeOutboundCallGroq() {
  try {
    const call = await client.calls.create({
      url: `https://${process.env.SERVER}/incoming-groq`,
      to: process.env.YOUR_NUMBER,
      from: process.env.FROM_NUMBER
    });
    console.log(`Call SID: ${call.sid} (Using Groq)`);
  } catch (error) {
    console.error('Error making outbound call:', error);
  }
}

// makeOutboundCallGroq();

module.exports = {
  makeOutboundCallGroq
};