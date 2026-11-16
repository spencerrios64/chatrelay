# chatrelay

One chat, several AIs. Pick which AI to talk to; when it hits its limit, the next one
takes over with the whole conversation, so nothing is forgotten.

**Use it here: https://spencerrios64.github.io/chatrelay/**

Supports ChatGPT (OpenAI), Claude (Anthropic), Gemini (Google), Groq, OpenRouter and
DeepSeek. It is a single web page (`index.html`): no server, no install, no dependencies.

## How it works

1. Open **Settings**, paste an API key for each AI you want, press **Load models** and
   pick a model. Gemini, Groq and OpenRouter offer free keys; OpenAI and Anthropic
   charge your account per message.
2. Choose which AI to chat with and when to switch:
   - it hits a usage limit or fails,
   - the chat is too long for it,
   - or both.
3. Chat. If the current AI can't answer, the app tells you why, sends the full
   conversation to the next AI that has a key, and carries on from there.

The app keeps the conversation itself and sends all of it with every message, which is
why a new AI knows everything the old one did. If the chat grows too long for every
AI, the oldest half is replaced by a detailed summary (written by one of the AIs) so
the chat can continue; that summary is the one point where detail can be lost.

## Windows

Open the link in Edge or Chrome and use the browser menu to install the page as an app
(Edge: Apps > Install this site as an app). You get a window and a Start menu entry.
There is no separate .exe.

## Good to know

- It uses official API keys. It cannot use your normal chatgpt.com or claude.ai login;
  those sites don't allow other apps to chat through them.
- Keys and the current chat are stored in this browser only (local storage) and are
  sent only to that AI's own API. Anyone who can use your browser profile can read
  them; use **Forget all keys** on a shared computer.
- The switching logic is tested with simulated API responses. Calls against the real
  APIs have not been tested with live keys yet, and a provider may block direct
  browser calls; if one never connects, open an issue.
- Replies are plain text (no markdown rendering) and arrive all at once (no streaming).
