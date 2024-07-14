require('dotenv').config();
require('colors');

const express = require('express');
const ExpressWs = require('express-ws');
const axios = require('axios');
const twilio = require('twilio');

const { GptService } = require('./services/gpt-service'); // Ensure this is the updated GptService
const { GroqService } = require('./services/groq-service');
const { StreamService } = require('./services/stream-service');
const { TranscriptionService } = require('./services/transcription-service');
const { TextToSpeechService } = require('./services/tts-service');
const { recordingService } = require('./services/recording-service');

const VoiceResponse = require('twilio').twiml.VoiceResponse;

const app = express();
ExpressWs(app);

const PORT = process.env.PORT || 3000;

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const client = twilio(accountSid, authToken);

app.use(express.json()); // To parse JSON request bodies

// Existing GPT route
app.post('/incoming', (req, res) => {
  try {
    const response = new VoiceResponse();
    const connect = response.connect();
    connect.stream({ url: `wss://${process.env.SERVER}/connection` });

    res.type('text/xml');
    res.end(response.toString());
  } catch (err) {
    console.log(err);
  }
});

// New Groq-specific route
app.post('/incoming-groq', (req, res) => {
  try {
    const response = new VoiceResponse();
    const connect = response.connect();
    connect.stream({ url: `wss://${process.env.SERVER}/connection-groq` });

    res.type('text/xml');
    res.end(response.toString());
  } catch (err) {
    console.log(err);
  }
});

// Outbound GPT Call Route with dynamic phone number
app.post('/outbound-call', async (req, res) => {
  const { to } = req.body; // Extract phone number from request body
  if (!to) {
    return res.status(400).json({ error: 'Phone number is required' });
  }

  try {
    const call = await client.calls.create({
      url: `https://${process.env.SERVER}/incoming`,
      to: to,
      from: process.env.FROM_NUMBER
    });
    console.log(`Call SID: ${call.sid}`);
    res.json({ message: 'Outbound call initiated successfully', callSid: call.sid });
  } catch (error) {
    console.error('Error making outbound call:', error);
    res.status(500).json({ error: 'Error making outbound call' });
  }
});

// Inbound Call Route
app.post('/inbound', async (req, res) => {
  try {
    const response = await axios.post('https://api.twilio.com/2010-04-01/Accounts/YOUR_ACCOUNT_SID/Calls.json', {
      To: process.env.YOUR_NUMBER,
      From: process.env.FROM_NUMBER,
      Url: 'http://your-server-url/twiml'
    }, {
      auth: {
        username: process.env.TWILIO_ACCOUNT_SID,
        password: process.env.TWILIO_AUTH_TOKEN
      }
    });

    res.json({ message: 'Inbound call handled successfully', data: response.data });
  } catch (error) {
    console.error('Error handling inbound call:', error);
    res.status(500).json({ error: 'Error handling inbound call' });
  }
});

// Existing GPT WebSocket route
app.ws('/connection', (ws) => {
  setupWebSocket(ws, false);
});

// New Groq-specific WebSocket route
app.ws('/connection-groq', (ws) => {
  setupWebSocket(ws, true);
});

function setupWebSocket(ws, useGroq) {
  try {
    ws.on('error', console.error);
    let streamSid;
    let callSid;

    const llmService = useGroq ? new GroqService() : new GptService();
    const streamService = new StreamService(ws);
    const transcriptionService = new TranscriptionService();
    const ttsService = new TextToSpeechService({});

    let marks = [];
    let interactionCount = 0;

    // Incoming from MediaStream
    ws.on('message', function message(data) {
      const msg = JSON.parse(data);
      if (msg.event === 'start') {
        streamSid = msg.start.streamSid;
        callSid = msg.start.callSid;

        streamService.setStreamSid(streamSid);
        llmService.setCallSid(callSid);

        // Set RECORDING_ENABLED='true' in .env to record calls
        recordingService(ttsService, callSid).then(() => {
          console.log(`Twilio -> Starting Media Stream for ${streamSid} (${useGroq ? 'Groq' : 'GPT'})`.underline.red);
          ttsService.generate({ partialResponseIndex: null, partialResponse: 'Hello! How can I assist you with your concern today?' }, 0);
        });
      } else if (msg.event === 'media') {
        transcriptionService.send(msg.media.payload);
      } else if (msg.event === 'mark') {
        const label = msg.mark.name;
        console.log(`Twilio -> Audio completed mark (${msg.sequenceNumber}): ${label} (${useGroq ? 'Groq' : 'GPT'})`.red);
        marks = marks.filter(m => m !== msg.mark.name);
      } else if (msg.event === 'stop') {
        console.log(`Twilio -> Media stream ${streamSid} ended (${useGroq ? 'Groq' : 'GPT'})`.underline.red);
      }
    });

    transcriptionService.on('utterance', async (text) => {
      if (marks.length > 0 && text?.length > 5) {
        console.log(`Twilio -> Interruption, Clearing stream (${useGroq ? 'Groq' : 'GPT'})`.red);
        ws.send(
          JSON.stringify({
            streamSid,
            event: 'clear',
          })
        );
      }
    });

    transcriptionService.on('transcription', async (text) => {
      if (!text) { return; }
      console.log(`Interaction ${interactionCount} – STT -> ${useGroq ? 'Groq' : 'GPT'}: ${text}`.yellow);
      llmService.completion(text, interactionCount);
      interactionCount += 1;
    });

    llmService.on(useGroq ? 'groqreply' : 'gptreply', async (reply, icount) => {
      console.log(`Interaction ${icount}: ${useGroq ? 'Groq' : 'GPT'} -> TTS: ${reply.partialResponse}`.green);
      ttsService.generate(reply, icount);
    });

    ttsService.on('speech', (responseIndex, audio, label, icount) => {
      console.log(`Interaction ${icount}: TTS -> TWILIO: ${label}`.blue);
      streamService.buffer(responseIndex, audio);
    });

    streamService.on('audiosent', (markLabel) => {
      marks.push(markLabel);
    });
  } catch (err) {
    console.log(err);
  }
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
