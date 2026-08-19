const { execFileSync } = require('child_process');

const TALKBACK_SERVICE = 'com.google.android.marvin.talkback/com.google.android.marvin.talkback.TalkBackService';
const TALKBACK_PACKAGE = 'com.google.android.marvin.talkback';

function adb(args) {
  return execFileSync('adb', args, { encoding: 'utf8' });
}

function isTalkBackInstalled() {
  const out = adb(['shell', 'pm', 'list', 'packages', TALKBACK_PACKAGE]);
  return out.includes(TALKBACK_PACKAGE);
}

function enableTalkBack() {
  adb(['shell', 'pm', 'grant', TALKBACK_PACKAGE, 'android.permission.POST_NOTIFICATIONS']);
  adb(['shell', 'settings', 'put', 'secure', 'enabled_accessibility_services', TALKBACK_SERVICE]);
  adb(['shell', 'settings', 'put', 'secure', 'accessibility_enabled', '1']);
  adb(['shell', 'settings', 'put', 'secure', 'touch_exploration_enabled', '1']);
}

function disableTalkBack() {
  adb(['shell', 'settings', 'delete', 'secure', 'enabled_accessibility_services']);
  adb(['shell', 'settings', 'put', 'secure', 'accessibility_enabled', '0']);
  adb(['shell', 'settings', 'put', 'secure', 'touch_exploration_enabled', '0']);
}

function isTalkBackEnabled() {
  try {
    const out = adb(['shell', 'settings', 'get', 'secure', 'enabled_accessibility_services']);
    return out.includes(TALKBACK_PACKAGE);
  } catch (e) {
    return false;
  }
}

// Reconstructs what TalkBack would say for a node, following the real
// announcement precedence Android uses: contentDescription wins over text;
// otherwise TalkBack falls back to child text for some containers. This
// mirrors android.view.accessibility logic closely enough to flag the same
// "nothing to announce" cases TalkBack itself would hit.
function speakableTextFor(attrs) {
  const desc = (attrs['content-desc'] || '').trim();
  const text = (attrs.text || '').trim();
  if (desc) return desc;
  if (text) return text;
  return null;
}

const ROLE_ANNOUNCEMENTS = {
  Button: /Button$/,
  ImageButton: /ImageButton$/,
  ImageView: /ImageView$/,
  EditText: /EditText$/,
  CheckBox: /CheckBox$/,
  Switch: /Switch$/,
};

function roleFor(className) {
  for (const [role, pattern] of Object.entries(ROLE_ANNOUNCEMENTS)) {
    if (pattern.test(className || '')) return role;
  }
  return null;
}

module.exports = {
  TALKBACK_SERVICE,
  TALKBACK_PACKAGE,
  isTalkBackInstalled,
  enableTalkBack,
  disableTalkBack,
  isTalkBackEnabled,
  speakableTextFor,
  roleFor,
};
