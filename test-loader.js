/**
 * Test script untuk memverifikasi loader sudah bekerja dengan baik
 * Jalankan dengan: node test-loader.js
 */

const path = require('path');
const fs = require('fs');

console.log('🧪 Testing Loader Configuration...\n');

// Check files
const files = {
  'loader.js': path.join(__dirname, 'loader.js'),
  'main.js': path.join(__dirname, 'main.js'),
  'dist/main-obfuscated.js': path.join(__dirname, 'dist', 'main-obfuscated.js'),
  'dist/main.jsc': path.join(__dirname, 'dist', 'main.jsc')
};

console.log('📁 Checking files:');
Object.entries(files).forEach(([name, filePath]) => {
  const exists = fs.existsSync(filePath);
  const status = exists ? '✅' : '❌';
  const size = exists ? `(${(fs.statSync(filePath).size / 1024).toFixed(2)} KB)` : '(not found)';
  console.log(`  ${status} ${name} ${size}`);
});

console.log('\n📦 Package.json configuration:');
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
console.log('  Main entry:', packageJson.main);
console.log('  Build files includes main.js:', packageJson.build.files.includes('main.js') ? '✅' : '❌');
console.log('  Build files includes dist/**/*:', packageJson.build.files.includes('dist/**/*') ? '✅' : '❌');

console.log('\n🔍 Loader.js analysis:');
const loaderContent = fs.readFileSync(files['loader.js'], 'utf8');
console.log('  Has fs.existsSync check:', loaderContent.includes('fs.existsSync') ? '✅' : '❌');
console.log('  Has fallback mechanism:', loaderContent.includes('fallbackPath') ? '✅' : '❌');
console.log('  Has detailed logging:', loaderContent.includes('console.log') ? '✅' : '❌');

console.log('\n✨ Test complete!');
console.log('\n📝 Next steps:');
console.log('  1. Run: npm run build-secure:win');
console.log('  2. Install the generated .exe from release/ folder');
console.log('  3. Check console logs when app starts');
