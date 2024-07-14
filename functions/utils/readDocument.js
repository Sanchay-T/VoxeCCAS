const fs = require('fs');
const path = require('path');

function readDocument(documentName, instruction) {
  const documentPath = path.join(__dirname, '../company', documentName);

  if (!fs.existsSync(documentPath)) {
    throw new Error(`Document not found: ${documentPath}`);
  }

  const documentContent = fs.readFileSync(documentPath, 'utf8');

  return {
    content: documentContent,
    instruction: instruction
  };
}

module.exports = { readDocument };
