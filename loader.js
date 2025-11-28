const { app } = require('electron');
const path = require('path');
const fs = require('fs');

/**
 * Secure Loader for Electron Application
 * 
 * This loader determines which version of the main process to load:
 * - Development: Loads original source code (./main.js) for debugging
 * - Production: Loads secured bytecode (./dist/main.jsc) for protection
 *               Falls back to main.js if bytecode is not available
 */

console.log('🚀 Starting Electron application...');
console.log('📂 Application directory:', __dirname);

// Determine if app is running in production (packaged) or development
const isProduction = app.isPackaged;

if (isProduction) {
  console.log('🔐 Running in PRODUCTION mode - Attempting to load secured bytecode');
  
  // Define possible paths for bytecode and fallback
  const bytecodePath = path.join(__dirname, 'dist', 'main.jsc');
  const fallbackPath = path.join(__dirname, 'main.js');
  
  console.log('🔍 Checking bytecode path:', bytecodePath);
  console.log('🔍 Fallback path:', fallbackPath);
  
  // Check if bytecode file exists
  if (fs.existsSync(bytecodePath)) {
    try {
      // Load the V8 bytecode compiled file
      require('bytenode');
      require(bytecodePath);
      
      console.log('✅ Secured bytecode loaded successfully');
    } catch (error) {
      console.error('❌ Error loading bytecode:', error);
      console.log('🔄 Attempting to load fallback source...');
      
      // Try fallback to original source
      if (fs.existsSync(fallbackPath)) {
        try {
          require(fallbackPath);
          console.log('✅ Fallback source loaded successfully');
        } catch (fallbackError) {
          console.error('❌ Error loading fallback source:', fallbackError);
          
          // Show error dialog to user
          const { dialog } = require('electron');
          dialog.showErrorBox(
            'Application Error',
            'Failed to load the application. Please reinstall or contact support.\n\nError: ' + fallbackError.message
          );
          
          app.quit();
        }
      } else {
        // No bytecode and no fallback
        const { dialog } = require('electron');
        dialog.showErrorBox(
          'Application Error',
          'Failed to load the application. Required files are missing.\n\nPlease reinstall the application.'
        );
        
        app.quit();
      }
    }
  } else {
    console.log('⚠️  Bytecode file not found, using fallback source');
    
    // Bytecode doesn't exist, try fallback
    if (fs.existsSync(fallbackPath)) {
      try {
        require(fallbackPath);
        console.log('✅ Fallback source loaded successfully');
      } catch (fallbackError) {
        console.error('❌ Error loading fallback source:', fallbackError);
        
        const { dialog } = require('electron');
        dialog.showErrorBox(
          'Application Error',
          'Failed to load the application. Please reinstall or contact support.\n\nError: ' + fallbackError.message
        );
        
        app.quit();
      }
    } else {
      // No files available
      const { dialog } = require('electron');
      dialog.showErrorBox(
        'Application Error',
        'Failed to load the application. Required files are missing.\n\nPlease reinstall the application.'
      );
      
      app.quit();
    }
  }
  
} else {
  console.log('🛠️  Running in DEVELOPMENT mode - Loading original source');
  
  try {
    // Load the original source file for development/debugging
    require(path.join(__dirname, 'main.js'));
    
    console.log('✅ Development source loaded successfully');
  } catch (error) {
    console.error('❌ Error loading source file:', error);
    app.quit();
  }
}
