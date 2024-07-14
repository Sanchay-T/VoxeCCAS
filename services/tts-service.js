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
      const response = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/mZ8K1MPRiT5wDQaasg3i/stream?output_format=ulaw_8000&optimize_streaming_latency=4`,
        {
          method: 'POST',
          headers: {
            'xi-api-key': process.env.XI_API_KEY,
            'Content-Type': 'application/json',
            accept: 'audio/wav',
          },
          body: JSON.stringify({
            model_id: process.env.XI_MODEL_ID,
            text: partialResponse,
          }),
        }
      );
    
      if (response.status === 200) {
        const audioArrayBuffer = await response.arrayBuffer();
        this.emit('speech', partialResponseIndex, Buffer.from(audioArrayBuffer).toString('base64'), partialResponse, interactionCount);
      } else {
        console.log('Eleven Labs Error:');
        console.log(response);
      }
    } catch (err) {
      console.error('Error occurred in XI LabsTextToSpeech service');
      console.error(err);
    }
  }
}

module.exports = { TextToSpeechService };