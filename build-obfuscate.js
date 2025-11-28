const JavaScriptObfuscator = require('javascript-obfuscator');
const fs = require('fs');
const path = require('path');

// Define paths
const sourceFile = path.join(__dirname, 'main.js');
const outputDir = path.join(__dirname, 'dist');
const outputFile = path.join(outputDir, 'main-obfuscated.js');

console.log('🔒 Starting obfuscation process...');

// Create dist directory if it doesn't exist
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
  console.log('✅ Created dist directory');
}

// Check if source file exists
if (!fs.existsSync(sourceFile)) {
  console.error(`❌ Error: Source file not found at ${sourceFile}`);
  process.exit(1);
}

// Read the source code
const sourceCode = fs.readFileSync(sourceFile, 'utf8');
console.log(`📖 Read source file: ${sourceFile}`);

// Obfuscation options - Heavy security
const obfuscationResult = JavaScriptObfuscator.obfuscate(sourceCode, {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.75,
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.4,
  debugProtection: false, // Set to false to avoid issues in production
  debugProtectionInterval: 0,
  disableConsoleOutput: false,
  identifierNamesGenerator: 'hexadecimal',
  log: false,
  numbersToExpressions: true,
  renameGlobals: false,
  selfDefending: true,
  simplify: true,
  splitStrings: true,
  splitStringsChunkLength: 10,
  stringArray: true,
  stringArrayCallsTransform: true,
  stringArrayEncoding: ['base64'],
  stringArrayIndexShift: true,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayWrappersCount: 2,
  stringArrayWrappersChainedCalls: true,
  stringArrayWrappersParametersMaxCount: 4,
  stringArrayWrappersType: 'function',
  stringArrayThreshold: 0.75,
  transformObjectKeys: true,
  unicodeEscapeSequence: false
});

// Write obfuscated code to output file
fs.writeFileSync(outputFile, obfuscationResult.getObfuscatedCode());

console.log(`✅ Obfuscation complete!`);
console.log(`📝 Output saved to: ${outputFile}`);
console.log(`📊 Original size: ${(sourceCode.length / 1024).toFixed(2)} KB`);
console.log(`📊 Obfuscated size: ${(obfuscationResult.getObfuscatedCode().length / 1024).toFixed(2)} KB`);
