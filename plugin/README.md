# chatrelay plugin

Lets Claude hand a conversation over to another AI, or pick one up from another AI,
without you repeating yourself.

## What you can ask

- "Hand this chat off" or "I'm about to hit my limit" - Claude writes a complete
  handoff file to give to ChatGPT, Gemini or any other AI.
- "Continue this chat" (with a handoff or transcript from another AI attached) -
  Claude reads it and carries on from where it stopped.

## What it can't do

Inside Claude, a plugin cannot switch to another AI by itself or tell when you are
near a usage limit; you ask for the handoff. For automatic switching with your own
API keys, use the chatrelay web app: https://spencerrios64.github.io/chatrelay/

Project: https://github.com/spencerrios64/chatrelay

## Install

In Claude Code:

```
/plugin install chatrelay --marketplace spencerrios64/chatrelay
```

In the Claude app, download this folder as a `.plugin` file (a zip of the `plugin` folder) and open it in a chat.
