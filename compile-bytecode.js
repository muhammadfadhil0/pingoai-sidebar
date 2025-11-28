const bytenode = require('bytenode');
const fs = require('fs');
const path = require('path');

// Define paths
const inputFile = path.join(__dirname, 'dist', 'main-obfuscated.js');
const outputFile = path.join(__dirname, 'dist', 'main.jsc');

console.log('🔐 Starting V8 bytecode compilation...');

// Check if input file exists
if (!fs.existsSync(inputFile)) {
  console.error(`❌ Error: Obfuscated file not found at ${inputFile}`);
  console.error('Please run build-obfuscate.js first!');
  process.exit(1);
}

try {
  // Compile to V8 bytecode
  bytenode.compileFile({
    filename: inputFile,
    output: outputFile
  });

  console.log(`✅ Bytecode compilation complete!`);
  console.log(`📝 Output saved to: ${outputFile}`);
  
  // Get file sizes for comparison
  const inputSize = fs.statSync(inputFile).size;
  const outputSize = fs.statSync(outputFile).size;
  
  console.log(`📊 Obfuscated JS size: ${(inputSize / 1024).toFixed(2)} KB`);
  console.log(`📊 Bytecode size: ${(outputSize / 1024).toFixed(2)} KB`);
  console.log('');
  console.log('🎉 Your application is now secured with obfuscation + bytecode!');
  console.log('⚠️  Remember: The original source files should NOT be included in production builds.');
  
} catch (error) {
  console.error('❌ Error during bytecode compilation:', error.message);
  process.exit(1);
}
