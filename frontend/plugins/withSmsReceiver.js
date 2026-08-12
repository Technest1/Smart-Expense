const { withAndroidManifest, withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const PACKAGE_PATH = 'com/smartexpense/app/sms';
const SOURCE_DIR = path.join(__dirname, '..', 'android-plugin-src');

// Adds the SMS_RECEIVED broadcast receiver + headless task service so incoming SMS
// wake the app in the background and re-run the same sync logic as the manual
// "Sync now" button — see frontend/android-plugin-src/*.kt for the actual native code.
function withSmsReceiverManifest(config) {
  return withAndroidManifest(config, (config) => {
    const app = config.modResults.manifest.application[0];

    if (!app.receiver) app.receiver = [];
    app.receiver.push({
      $: {
        'android:name': '.sms.SmsReceiver',
        'android:exported': 'true',
        'android:enabled': 'true',
      },
      'intent-filter': [
        {
          action: [{ $: { 'android:name': 'android.provider.Telephony.SMS_RECEIVED' } }],
        },
      ],
    });

    if (!app.service) app.service = [];
    app.service.push({
      $: {
        'android:name': '.sms.SmsHeadlessTaskService',
        'android:exported': 'false',
      },
    });

    return config;
  });
}

function withSmsReceiverSource(config) {
  return withDangerousMod(config, [
    'android',
    (config) => {
      const destDir = path.join(
        config.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'java',
        PACKAGE_PATH
      );
      fs.mkdirSync(destDir, { recursive: true });
      for (const file of ['SmsReceiver.kt', 'SmsHeadlessTaskService.kt']) {
        fs.copyFileSync(path.join(SOURCE_DIR, file), path.join(destDir, file));
      }
      return config;
    },
  ]);
}

module.exports = function withSmsReceiver(config) {
  config = withSmsReceiverManifest(config);
  config = withSmsReceiverSource(config);
  return config;
};
