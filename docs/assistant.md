# Asking the wall things

"Hey wall, how far away is the moon?" Anything you ask the wall that isn't one
of its [commands](voice-commands.md) and sounds like a question is answered
by a small AI model on [Ollama Cloud](https://ollama.com), which can search
the web. The answer is spoken (see [voice.md](voice.md)) and captioned on the
island.

It works the same from the wall's microphone, "Hey Siri, tell the wall …", the
**Try a phrase** box on the phone, and `POST /api/tasks/say`.

## What counts as a question

After the command list has had its turn, a sentence goes to the assistant when
it starts like a question (*who, what, when, where, why, how, is, can, should,
tell me, explain, look up, search for, define, convert …*) or ends in a
question mark. Filler first is fine: "hey wall, could you please look up …".

Things you want *added* still always go on the list: anything starting with
*remind me, add, chore, to-do, I need to, I have to* is a chore or an alert,
never a question. "Take out the bins at 6" is a chore, as before.

Without a key nothing changes: an unknown sentence is added to the list,
exactly as it always was.

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
| Prompt | Four lines: answer out loud in one or two short sentences, no lists or links, search only for recent or uncertain facts, and today's date. `ASSISTANT_PLACE` adds where you are ("Largo, Florida") for local questions. |
| Reasoning | `think: low` |
| Search | Ollama's `web_search`, three results trimmed to 600 characters each, at most two searches per question. After that the model has to answer. |
| Follow-ups | The last two questions and answers, for three minutes, so "and how tall is it?" works. |
| Timeout | 20 seconds, then "That took too long to look up." |

When Ollama refuses (a bad key, the free limit for the day), the wall says so
instead of guessing. `GET /api/assistant` shows whether a key is set, the
model, and how many questions and searches today.

Ollama's web search and cloud models need an Ollama account. Usage limits are
on the account's usage page at ollama.com.

## API

Same Bearer token as `/api/tasks`.

| | |
| --- | --- |
| `GET /api/assistant` | `{ hasKey, keySource, model, askedToday, searchesToday }` |
| `POST /api/assistant/ask` | `{ text }` or a text/plain body → `{ say, answered, model }` |

Code: `src/lib/assistant.js` (what counts as a question, the prompt, cleaning
the answer for speech), `src/lib/server/assistantHub.js` (the Ollama calls),
tests in `tests/assistant.test.mjs`.
