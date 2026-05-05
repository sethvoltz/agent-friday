---
description: Take a screenshot of a running web app and post it to Slack. Handles dev server detection, Playwright-based capture, and Slack upload automatically.
when_to_use: When the user asks to screenshot the app, capture a UI state, share what the app looks like, or verify a visual change. Also use after implementing a UI feature when you want to show the result.
disable-model-invocation: false
user-invocable: true
scope: [builder]
---

Capture a screenshot of the web app and post it to Slack.

## Steps

### 1. Detect the dev server command

Read `package.json` in the repo root to discover how to boot the app. Do not assume a framework.

```bash
node -e "const s=require('./package.json').scripts||{}; const keys=['dev','start','serve','develop','preview']; const k=keys.find(k=>s[k]); console.log(k?s[k]:'')"
```

If no matching script is found, check `package.json` of each workspace package (look in `packages/*/package.json` and `apps/*/package.json`) for the same keys. Pick the first match and note the package directory.

If still not found, stop and report — you cannot boot the app without knowing the command.

### 2. Start the dev server on an alternate port

Use port **3742** to avoid colliding with an already-running server. Override the port via the `PORT` environment variable and, if the framework supports it, a `--port` flag.

```bash
PORT=3742 <dev-command> --port 3742 &> /tmp/devserver-$$.log &
DEV_PID=$!
```

Wait for the server to report it is ready. Poll `/tmp/devserver-$$.log` for any of these patterns: `ready`, `listening`, `Local:`, `http://`, `localhost`. Timeout after 60 seconds.

```bash
timeout 60 bash -c 'until grep -qE "ready|listening|Local:|http://|localhost" /tmp/devserver-$$.log 2>/dev/null; do sleep 1; done'
```

Derive the base URL from the log. If the log contains a `localhost` URL, extract it. Otherwise default to `http://localhost:3742`.

### 3. Check for Playwright and install if needed

Playwright browsers are cached at `~/Library/Caches/ms-playwright/`. Check whether Chromium is already installed before running an install:

```bash
if ls ~/Library/Caches/ms-playwright/chromium-* 1>/dev/null 2>&1; then
  echo "Chromium found, skipping install"
else
  echo "Chromium not found, installing..."
  npx playwright install chromium --with-deps
fi
```

### 4. Navigate and capture the screenshot

Use `npx playwright` to launch Chromium, navigate to the app, and take a screenshot. Write a small inline script to a temp file, then execute it:

```bash
SCREENSHOT_PATH="/tmp/screenshot-$$.png"
TARGET_URL="<url-from-step-2>"

cat > /tmp/pw-screenshot-$$.mjs << 'EOF'
import { chromium } from 'playwright';

const url = process.argv[2];
const out = process.argv[3];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.setViewportSize({ width: 1280, height: 800 });
await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.screenshot({ path: out, fullPage: false });
await browser.close();
EOF

node /tmp/pw-screenshot-$$.mjs "$TARGET_URL" "$SCREENSHOT_PATH"
```

If you need to interact with the app first (navigate to a specific route, click a button, fill a form), add those `page.*` calls before `page.screenshot(...)`.

### 5. Upload to Slack

Use the two-step Slack upload API. You need:
- `SLACK_BOT_TOKEN` — must be set in the environment
- A Slack channel ID or name (use the channel from the active thread if one exists, otherwise ask)

**Step A — get an upload URL:**

```bash
FILENAME="screenshot-$(date +%Y%m%d-%H%M%S).png"
FILESIZE=$(wc -c < "$SCREENSHOT_PATH" | tr -d ' ')

UPLOAD_RESPONSE=$(curl -s -X POST "https://slack.com/api/files.getUploadURLExternal" \
  -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "filename=$FILENAME" \
  --data-urlencode "length=$FILESIZE")

UPLOAD_URL=$(echo "$UPLOAD_RESPONSE" | node -e "process.stdin.setEncoding('utf8'); let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>console.log(JSON.parse(d).upload_url||''))")
FILE_ID=$(echo "$UPLOAD_RESPONSE" | node -e "process.stdin.setEncoding('utf8'); let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>console.log(JSON.parse(d).file_id||''))")
```

Check that `UPLOAD_URL` and `FILE_ID` are non-empty before continuing. If `ok` is `false` in the response, report the error and stop.

**Step B — upload the file content:**

```bash
curl -s -X POST "$UPLOAD_URL" \
  -H "Content-Type: application/octet-stream" \
  --data-binary @"$SCREENSHOT_PATH"
```

**Step C — complete the upload and post to channel:**

```bash
CHANNEL_ID="<channel-id>"

COMPLETE_RESPONSE=$(curl -s -X POST "https://slack.com/api/files.completeUploadExternal" \
  -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"files\":[{\"id\":\"$FILE_ID\"}],\"channel_id\":\"$CHANNEL_ID\"}")

echo "$COMPLETE_RESPONSE" | node -e "process.stdin.setEncoding('utf8'); let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{const r=JSON.parse(d); console.log(r.ok?'Upload complete':'Error: '+r.error)})"
```

### 6. Cleanup

Always clean up, even if an earlier step failed:

```bash
# Kill the dev server
kill "$DEV_PID" 2>/dev/null
wait "$DEV_PID" 2>/dev/null

# Remove temp files
rm -f "$SCREENSHOT_PATH" /tmp/devserver-$$.log /tmp/pw-screenshot-$$.mjs
```

## Notes

- **Port conflicts:** If port 3742 is already in use, try 3743, 3744. Check with `lsof -ti:3742` first.
- **Auth-gated routes:** If the target URL redirects to a login page, add Playwright steps to authenticate before screenshotting.
- **Specific routes:** If the user asks to screenshot a particular page, append the path to the base URL (e.g. `http://localhost:3742/dashboard`).
- **Thread uploads:** If you are connected to a Slack thread, pass `thread_ts` in the `completeUploadExternal` body to post the image as a thread reply rather than a new message.
- **`SLACK_BOT_TOKEN` missing:** If the env var is not set, report it clearly. Do not attempt the upload.
