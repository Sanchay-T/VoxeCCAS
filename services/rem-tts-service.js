const EventEmitter = require('events');
const fetch = require('node-fetch');

class RemTtsService extends EventEmitter {
  constructor(options = {}) {
    super();
    this.apiKey = process.env.REM_API_KEY;
    this.speaker = process.env.REM_SPEAKER || 'tanya';
    this.modelId = process.env.REM_MODEL_ID || 'mist';
  }

  async generate(text, interactionCount) {
    try {
      const requestBody = {
        speaker: this.speaker,
        text: typeof text === 'string' ? text : text.partialResponse,
        modelId: this.modelId,
        speedAlpha: 1.0,
        reduceLatency: false
      };

      console.log('Rem TTS Request:', JSON.stringify(requestBody, null, 2));

      const response = await fetch('https://users.rime.ai/v1/rime-tts', {
        method: 'POST',
        headers: {
          'Accept': 'audio/x-mulaw',
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`HTTP error! status: ${response.status}, body: ${errorBody}`);
      }

      const audioBuffer = await response.arrayBuffer();
      const audioData = Buffer.from(audioBuffer);

      this.emit('speech', 0, audioData, text.partialResponse, interactionCount);
      this.emit('speech_end', interactionCount);

    } catch (error) {
      console.error('Error in Rem TTS service:', error);
      this.emit('tts_error', error);
    }
  }
}

module.exports = { RemTtsService };