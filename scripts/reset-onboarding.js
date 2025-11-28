#!/usr/bin/env node

/**
 * Script to reset onboarding status
 * This will force the onboarding screen to show on next app start
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// Determine the config file path based on platform
function getConfigPath() {
  const appName = 'pingoai';
  let configDir;

  switch (process.platform) {
    case 'win32':
      configDir = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), appName);
      break;
    case 'darwin':
      configDir = path.join(os.homedir(), 'Library', 'Application Support', appName);
      break;
    default: // linux
      configDir = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), appName);
  }

  return path.join(configDir, 'config.json');
}

function resetOnboarding() {
  const configPath = getConfigPath();

  console.log('🔄 Resetting onboarding status...');
  console.log('📁 Config path:', configPath);

  try {
    if (fs.existsSync(configPath)) {
      // Read existing config
      const configData = fs.readFileSync(configPath, 'utf8');
      const config = JSON.parse(configData);

      // Remove onboarding completed flag
      delete config.onboardingCompleted;

      // Save updated config
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      console.log('✅ Onboarding status reset successfully!');
      console.log('🎉 Next app start will show onboarding screen');
    } else {
      console.log('ℹ️  No config file found - onboarding will show on first run');
    }
  } catch (error) {
    console.error('❌ Error resetting onboarding:', error.message);
    process.exit(1);
  }
}

resetOnboarding();
