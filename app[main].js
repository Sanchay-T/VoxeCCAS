require('dotenv').config();
require('colors');

const express = require('express');
const ExpressWs = require('express-ws');

const { GptService } = require('./services/gpt-service');
const { GroqService } = require('./services/groq-service');
const { StreamService } = require('./services/stream-service');
const { TranscriptionService } = require('./services/transcription-service');
const { TextToSpeechService } = require('./services/tts-service');
const { recordingService } = require('./services/recording-service');

const VoiceResponse = require('twilio').twiml.VoiceResponse;

const app = express();
ExpressWs(app);

const PORT = process.env.PORT || 3000;

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
          ttsService.generate({partialResponseIndex: null, partialResponse: 'Hello! I understand you\'re looking for a pair of AirPods, is that correct?'}, 0);
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
      if(marks.length > 0 && text?.length > 5) {
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

app.listen(PORT);
console.log(`Server running on port ${PORT}`);