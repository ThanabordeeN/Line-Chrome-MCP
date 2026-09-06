# Setup lessons learned

This document records the failure modes found while installing and validating
Line Chrome MCP against a real logged-in LINE Chrome Extension session. It is
intended to make the next setup reproducible instead of relying on process
guessing or trial and error.

## 1. Build output and package entry points must agree

The TypeScript configuration uses `rootDir: "."` and includes both `src/` and
`test/`. That produces:

```text
dist/src/index.js
dist/src/mcp/stdio.js
dist/test/*.test.js
```

The original package scripts and `bin` entries pointed at `dist/index.js` and
`dist/mcp/stdio.js`, so `npm start` failed with `MODULE_NOT_FOUND` even though
`npm run build` succeeded. The package scripts, binary entries, lockfile, and
README now use the actual `dist/src/...` paths.

Validation command:

```bash
npm run check
```

## 2. The stdio MCP process is not the gateway

`dist/src/mcp/stdio.js` only translates MCP requests into HTTP requests to the
gateway. It does not own Chrome, CDP, or the LINE session. The correct runtime
order is:

```text
Chrome + LINE Extension
        ↓ CDP
line-gateway :8787
        ↓ localhost REST
line-mcp stdio proxy
        ↓
MCP host / Codex
```

Starting only the stdio process makes tool discovery work, but tool calls fail
until `npm start` is already serving the gateway. The gateway can start before
Chrome is ready, but message and chat operations need a usable LINE page.

## 3. A running LINE window is not automatically a usable CDP target

The LINE Extension runs inside Chrome as extension/renderer processes. There is
usually no standalone process named `line` to find. The adapter uses
`chromium.connectOverCDP()` and then scans the pages exposed by that exact CDP
endpoint.

Always compare these facts:

```bash
ps -ef | rg 'chrome|chromium'
curl http://127.0.0.1:9222/json/list
```

The process that owns the LINE window and the CDP endpoint in `LINE_CDP_URL`
must be the same Chrome instance. Process listings alone cannot prove that the
gateway can use the extension.

## 4. Chrome profile and CDP port are part of the connection identity

The normal Chrome profile may contain the logged-in LINE account but not expose
remote debugging. A separate profile with `--remote-debugging-port` is the
reliable setup for Chrome 136+.

If the actual LINE Chrome instance uses port `9223`, starting the gateway with
the default `9222` produces a misleading diagnosis: Chrome may be running, but
the gateway sees no LINE page. Set the gateway explicitly:

```bash
LINE_CDP_URL=http://127.0.0.1:9223 npm start
```

The gateway's own port (`LINE_GATEWAY_PORT`, normally `8787`) is unrelated to
the Chrome CDP port.

## 5. Use the real extension page, not `view-source:`

The adapter looks for pages whose URL starts with `chrome-extension://` and
then checks LINE-specific markers such as:

```text
button[aria-label="Go chatroom"]
textarea-ex[placeholder="Enter a message"]
```

The following is not a usable target:

```text
view-source:chrome-extension://...
```

Open the actual LINE extension page in the remotely-debugged profile and make
sure it is logged in. A page can exist in `/json/list` while still being a
login/error page without the expected LINE markers.

## 6. Extension installation and profile state matter

Copying a Web Store extension's installed files into a fresh profile and using
`--load-extension` is not the same as installing the extension normally. It can
produce a blocked extension page or a profile without the account's login
state. For a clean setup, install LINE in the dedicated profile through the
normal Chrome extension flow, then log in there.

If the extension is already installed in another profile, that proves the files
exist but does not prove the dedicated CDP profile has the same extension,
permissions, cookies, or storage.

## 7. Readiness has two independent parts

`/v1/status` distinguishes transport from page readiness:

- `connected: false`: CDP connection failed.
- `connected: true, ready: false`: CDP works, but no LINE page with the
  expected markers was found.
- `ready: true`: the adapter found the LINE page and an active chat target.

This is more useful than checking whether a Chrome process exists.

## 8. Chat lookup and message lookup are different operations

Chat search filters the virtualized chat list by title. It does not search the
text of every message. Message reads require a chat ID and may scroll the
active chat history to collect rendered messages.

Therefore:

1. Search by chat title or nickname.
2. If the name is ambiguous, show the matching chats.
3. Read messages from the selected chat.
4. If the chat title cannot identify the person, use a known phrase, time
   range, group name, or other context and scan candidate chats.

The adapter currently limits chat enumeration to 200 results and history reads
to the configured `LINE_MAX_HISTORY_SCROLLS`. Virtualized or never-rendered
content may not be available in a single request.

## 9. Sending needs operation verification

Text sends are queued because LINE UI actions must be serialized. A successful
HTTP `202` only means the operation was queued. Poll
`/v1/operations/:id` until it reaches `succeeded` or `failed`.

Use an `Idempotency-Key` for retries. On success, the adapter verifies that a
matching outgoing message ID appeared in the LINE DOM.

Before sending, resolve the chat title to a chat ID. If multiple names match,
ask for confirmation instead of guessing the recipient.

## 10. Codex and Node environment details

Codex launches MCP commands without an interactive shell. An NVM-managed
`node` command may therefore not be on `PATH`. Register the MCP server with an
absolute Node binary path:

```bash
codex mcp add line \
  --env LINE_GATEWAY_URL=http://127.0.0.1:8787 \
  -- /absolute/path/to/node /absolute/path/to/Line-Chrome-MCP/dist/src/mcp/stdio.js
```

Use `codex mcp get line` to inspect the effective command, arguments, and
gateway URL. Restart the MCP host after changing its global configuration.

## Recovery checklist

```bash
npm run check
curl http://127.0.0.1:9223/json/version
curl http://127.0.0.1:9223/json/list
LINE_CDP_URL=http://127.0.0.1:9223 npm start
curl http://127.0.0.1:8787/v1/status
codex mcp get line
```

Do not expose the gateway beyond loopback without configuring
`LINE_GATEWAY_TOKEN` and adding appropriate access controls. The gateway
controls a logged-in personal LINE account and should be treated as sensitive.
