require('dotenv').config();
const { Buffer } = require('node:buffer');
const EventEmitter = require('events');
const fetch = require('node-fetch');

class TextToSpeechService extends EventEmitter {
  constructor() {
    super();
    this.nextExpectedIndex = 0;
    this.speechBuffer = {};
  }

  async generate(gptReply, interactionCount) {
    const { partialResponseIndex, partialResponse } = gptReply;

    if (!partialResponse) { return; }

    try {
      const response = await fetch('https://users.rime.ai/v1/rime-tts', {
        method: 'POST',
        headers: {
          'Accept': 'audio/x-mulaw',
          'Authorization': `Bearer ${process.env.REM_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          speaker: process.env.REM_SPEAKER || 'tanya',
          text: partialResponse,
          modelId: process.env.REM_MODEL_ID || 'mist',
          speedAlpha: 0.6,
          reduceLatency: true
        })
      });

      if (response.ok) {
        const audioArrayBuffer = await response.arrayBuffer();
        this.emit('speech', partialResponseIndex, Buffer.from(audioArrayBuffer).toString('base64'), partialResponse, interactionCount);
      } else {
        console.log('Rime TTS Error:');
        console.log(await response.text());
      }
    } catch (err) {
      console.error('Error occurred in Rime TTS service');
      console.error(err);
    }
  }
}

module.exports = { TextToSpeechService };