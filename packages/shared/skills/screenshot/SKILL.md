---
description: Take a screenshot of a running web app and deliver it — either to Slack or embedded in a PR description. Handles dev server detection, Playwright-based capture, and delivery automatically.
when_to_use: When the user asks to screenshot the app, capture a UI state, verify a visual change, or share what the app looks like. Use Slack delivery when in an interactive session. Use PR description delivery when adding visual evidence to an async code review or when there is no active Slack thread.
disable-model-invocation: false
user-invocable: true
scope: [builder]
---

Capture a screenshot of the web app and deliver it to Slack or a PR description.

## Choose a delivery mode

- **Slack** — use when you are in an active Slack thread and want to share the screenshot immediately in the conversation.
- **PR description** — use when you have an open PR and want to embed the screenshot as visual evidence for async review. Prefer this when there is no active thread or the context is code review.

## Steps

### 1. Identify the target package and dev server command

Identify which package contains the GUI you're demonstrating based on your task context — the files you modified and the component you built. **Do not auto-scan workspace packages.** In a monorepo, multiple packages may have dev scripts; picking the wrong one captures the wrong UI. If the target is ambiguous from your task context, ask the user before proceeding.

Once you know the target directory, read its `package.json` to find the dev server command:

```bash
node -e "const s=require('./package.json').scripts||{}; const keys=['dev','start','serve','develop','preview']; const k=keys.find(k=>s[k]); console.log(k?s[k]:'')"
```

If no matching script is found, stop and report — you cannot boot the app without knowing the command.

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

### 5. Deliver the screenshot

Choose one delivery mode based on context. Slack for interactive sessions; PR description for async review.

#### 5a. Post to Slack

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

#### 5b. Add to PR description

Upload the screenshot as a GitHub asset to get a CDN URL, then append a Markdown image block to the PR body. The image will be visible to anyone with repo access without requiring Slack credentials.

**Step A — get repo and PR context:**

```bash
OWNER=$(gh repo view --json owner --jq '.owner.login')
REPO=$(gh repo view --json name --jq '.name')
PR_NUMBER=$(gh pr view --json number --jq '.number')
```

**Step B — upload the screenshot as a GitHub asset:**

```bash
UPLOAD_RESPONSE=$(gh api \
  -X POST \
  "https://uploads.github.com/repos/$OWNER/$REPO/issues/$PR_NUMBER/assets" \
  -H "Content-Type: image/png" \
  --input "$SCREENSHOT_PATH")

IMAGE_URL=$(echo "$UPLOAD_RESPONSE" | jq -r '.url // empty')
```

Check that `IMAGE_URL` is non-empty. If the upload failed (e.g. no open PR), fall back to Slack delivery if a thread is active, or report and stop.

**Step C — append the screenshot section to the PR body:**

```bash
CURRENT_BODY=$(gh pr view "$PR_NUMBER" --json body --jq '.body // ""')
TIMESTAMP=$(date +%Y%m%d-%H%M%S)

NEW_BODY=$(printf '%s\n\n## Screenshot\n\n![Screenshot %s](%s)\n' \
  "$CURRENT_BODY" "$TIMESTAMP" "$IMAGE_URL")

gh pr edit "$PR_NUMBER" --body "$NEW_BODY"
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

- **Choosing delivery mode:** Prefer Slack when in an interactive session — the image appears immediately in the conversation. Prefer PR description when handing off visual evidence for review — it stays with the PR and is visible without Slack access.
- **Port conflicts:** If port 3742 is already in use, try 3743, 3744. Check with `lsof -ti:3742` first.
- **Auth-gated routes:** If the target URL redirects to a login page, add Playwright steps to authenticate before screenshotting.
- **Specific routes:** If the user asks to screenshot a particular page, append the path to the base URL (e.g. `http://localhost:3742/dashboard`).
- **Thread uploads (Slack):** If you are connected to a Slack thread, pass `thread_ts` in the `completeUploadExternal` body to post the image as a thread reply rather than a new message.
- **`SLACK_BOT_TOKEN` missing:** If the env var is not set, report it clearly. Do not attempt the Slack upload — switch to PR description delivery if a PR is open.
