// Spendly widget loader for the Scriptable iOS app: paste this once instead of the full widget.
// Each run downloads spendly-widget.js from the site and runs it, so widget changes go live on push.
// Offline, it runs the last copy it downloaded.

const SRC = 'https://mahmoud35amri.github.io/Expenses-track/widget/spendly-widget.js';
const CODE_FILE = 'spendly-widget-code.js';

const fm = FileManager.local();
const codePath = fm.joinPath(fm.cacheDirectory(), CODE_FILE);
let code;
try {
  const req = new Request(SRC);
  req.timeoutInterval = 10;
  code = await req.loadString();
  // Don't cache an error page (404, captive portal) over the last good copy.
  if (req.response.statusCode !== 200 || !code.includes('Script.setWidget')) throw new Error('Could not download the widget code');
  fm.writeString(codePath, code);
} catch (e) {
  if (!fm.fileExists(codePath)) throw e;
  code = fm.readString(codePath);
}
// Direct eval so the widget code sees the same script globals (config, args) as a pasted script.
await eval(`(async () => {\n${code}\n})()`);
