# Talking to the wall

The wall is meant to be talked to casually, like a Google or Alexa speaker.
Its fixed [commands](voice-commands.md) ("pause", "I'm done with the bins")
and anything said as something to add ("remind me…", "add milk to the
list") are handled instantly on the wall. **Everything else is a
conversation** with a small AI model on [Ollama Cloud](https://ollama.com):

| You say | The wall |
| --- | --- |
| how far away is the moon? | answers |
| who won the game last night? | searches the web, then answers |
| thanks, that was great / how are you? / tell me a joke | chats back |
| it's way too loud in here | turns it down ("Volume 40 percent.") |
| can we get some jazz going | plays jazz on Apple Music |
| don't let me forget mom's birthday on Friday | adds it to the list |
| what's happening tomorrow? | reads tomorrow's items |
| make me a coffee | tells you it can't |
| hmm, the thing | asks what you meant |

It answers in a sentence or two, casually, and remembers the last few
exchanges for five minutes, so "and tomorrow?" or "how tall is it?" work.
When it asks you something, the microphone keeps listening for the answer
without "hey wall".

It works the same from the wall's microphone, "Hey Siri, tell the wall …",
the **Try a phrase** box on the phone, and `POST /api/tasks/say`.

## What it can do

The model gets four tools, and acts through the wall's own code:

| Tool | Does |
| --- | --- |
| `wall` | any display command in plain words: music, volume, timers, the list ("I'm done with the dishes"), views, the screen, the weather, announcements, undo. The command's own answer is what the wall says, with no second model call |
| `remember` | adds to the list, only when you clearly want something remembered or done later |
| `play` | Apple Music on the wall (see [apple-music.md](apple-music.md)) |
| `web_search` | Ollama's web search, for recent or uncertain facts |

Without a key the wall never guesses: anything it didn't recognise gets
"Should I add … to your list?" first.

## Set up the key

1. Make a free account at ollama.com and create a key under
   **Settings → Keys**.
2. On the kiosk:

   ```bash
   printf '%s' 'YOUR_OLLAMA_KEY' > data/ollama-key
   chmod 600 data/ollama-key
   ```

   or set `OLLAMA_API_KEY` in the service's environment (it wins over the
   file). No restart: the key is read on every question.

`data/ollama-key` is gitignored and never sent to a phone.

## Kept cheap

Every request is as small as it can be:

| | |
| --- | --- |
| Model | `gpt-oss:20b`, the smallest Ollama Cloud model that can call tools. `ASSISTANT_MODEL` picks another. |
| Prompt | Five short lines: casual and brief, when to use which tool, chat back when it's chat, ask when unsure, and today's date. `ASSISTANT_PLACE` adds where you are ("Largo, Florida") for local questions. |
| Reasoning | `think: low` |
| Acting | When it only runs a command, adds or plays, the action's own sentence is spoken: one model call, not two. |
| Search | Ollama's `web_search`, three results trimmed to 600 characters each, at most two searches and three rounds per sentence. |
| Follow-ups | The last three exchanges, for five minutes. |
| Timeout | 20 seconds, then "That took me too long. Try asking again." |

When Ollama refuses (a bad key, the free limit for the day), the wall says so
instead of guessing. `GET /api/assistant` shows whether a key is set, the
model, and how many questions and searches today.

Ollama's web search and cloud models need an Ollama account. Usage limits are
on the account's usage page at ollama.com.

## API

Same Bearer token as `/api/tasks`.

| | |
| --- | --- |
| `GET /api/assistant` | `{ hasKey, keySource, model, askedToday, searchesToday, actionsToday }` |
| `POST /api/assistant/ask` | `{ text }` or a text/plain body → `{ say, followUp, acted?, model }` |

Code: `src/lib/assistant.js` (the prompt, the tools, cleaning the answer for
speech), `src/lib/server/assistantHub.js` (the conversation and its tools),
`src/lib/server/taskHub.js` `sayAdd` (the order a sentence goes through);
tests in `tests/assistant.test.mjs` and `tests/task-hub.test.mjs`.
