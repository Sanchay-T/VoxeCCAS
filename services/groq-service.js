const EventEmitter = require('events');
const { Groq } = require("groq-sdk");
const tools = require('../functions/function-manifest');

// Import all functions included in function manifest
const availableFunctions = {};
tools.forEach((tool) => {
  let functionName = tool.function.name;
  availableFunctions[functionName] = require(`../functions/${functionName}`);
});

class GroqService extends EventEmitter {
  constructor() {
    super();
    this.groq = new Groq({
      apiKey: process.env.GROQ_API_KEY
    });
    this.userContext = [
      { 'role': 'system', 'content': 'You are an outbound sales representative selling Apple Airpods. You have a youthful and cheery personality. Keep your responses as brief as possible but make every attempt to keep the caller on the phone without being rude. Don\'t ask more than 1 question at a time. Don\'t make assumptions about what values to plug into functions. Ask for clarification if a user request is ambiguous. Speak out all prices to include the currency. Please help them decide between the airpods, airpods pro and airpods max by asking questions like \'Do you prefer headphones that go in your ear or over the ear?\'. If they are trying to choose between the airpods and airpods pro try asking them if they need noise canceling. Once you know which model they would like ask them how many they would like to purchase and try to get them to place an order. You must add a \'•\' symbol every 5 to 10 words at natural pauses where your response can be split for text to speech.' },
      { 'role': 'assistant', 'content': 'Hello! I understand you\'re looking for a pair of AirPods, is that correct?' },
    ];
    this.partialResponseIndex = 0;
    this.callSid = null;
  }

  setCallSid(callSid) {
    this.callSid = callSid;
    this.userContext.push({ 'role': 'system', 'content': `callSid: ${callSid}` });
  }

  validateFunctionArgs(args) {
    try {
      return JSON.parse(args);
    } catch (error) {
      console.log('Warning: Invalid function arguments returned by Groq:', args);
      return null;
    }
  }

  updateUserContext(name, role, text) {
    if (name !== 'user') {
      this.userContext.push({ 'role': role, 'name': name, 'content': text });
    } else {
      this.userContext.push({ 'role': role, 'content': text });
    }
  }

  async completion(text, interactionCount, role = 'user', name = 'user') {
    this.updateUserContext(name, role, text);

    try {
      const stream = await this.groq.chat.completions.create({
        messages: this.userContext,
        model: "llama3-8b-8192",
        temperature: 0.5,
        max_tokens: 1024,
        top_p: 1,
        stream: true,
        tools: tools
      });

      let completeResponse = '';
      let partialResponse = '';
      let functionName = '';
      let functionArgs = '';

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || '';
        const toolCalls = chunk.choices[0]?.delta?.tool_calls;

        if (toolCalls) {
          functionName = toolCalls[0]?.function?.name || functionName;
          functionArgs += toolCalls[0]?.function?.arguments || '';
        } else if (content) {
          completeResponse += content;
          partialResponse += content;

          if (content.includes('•') || chunk.choices[0].finish_reason === 'stop') {
            const parts = partialResponse.split('•');
            for (let i = 0; i < parts.length - 1; i++) {
              this.emit('groqreply', {
                partialResponseIndex: this.partialResponseIndex,
                partialResponse: parts[i].trim()
              }, interactionCount);
              this.partialResponseIndex++;
            }
            partialResponse = parts[parts.length - 1];
          }
        }

        if (chunk.choices[0].finish_reason === 'tool_calls') {
          const functionToCall = availableFunctions[functionName];
          const validatedArgs = this.validateFunctionArgs(functionArgs);

          if (functionToCall && validatedArgs) {
            const toolData = tools.find(tool => tool.function.name === functionName);
            const say = toolData.function.say;

            this.emit('groqreply', {
              partialResponseIndex: null,
              partialResponse: say
            }, interactionCount);

            let functionResponse = await functionToCall(validatedArgs);
            this.updateUserContext(functionName, 'function', functionResponse);
            await this.completion(functionResponse, interactionCount, 'function', functionName);
          }
        }
      }

      if (partialResponse.trim()) {
        this.emit('groqreply', {
          partialResponseIndex: this.partialResponseIndex,
          partialResponse: partialResponse.trim()
        }, interactionCount);
        this.partialResponseIndex++;
      }

      this.userContext.push({'role': 'assistant', 'content': completeResponse});
      console.log(`Groq -> user context length: ${this.userContext.length}`.green);

    } catch (error) {
      console.error('Error in Groq service:', error);
      this.emit('groq_error', error);
    }
  }
}

module.exports = { GroqService };