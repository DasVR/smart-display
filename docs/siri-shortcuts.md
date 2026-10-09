# Siri, the Action button and Shortcuts

Talk to the wall without opening anything. Each recipe below is a short
shortcut in Apple's **Shortcuts** app pointed at the display. The phone
remote has the same recipes with your display's address already filled in:
**Tasks → Siri & Shortcuts** (`/remote/shortcuts`). That page also has a
**Try a phrase** box, so you can check how the wall understands a sentence
before you set up Siri.

Your phone needs to be on the same Wi-Fi as the display. If you locked the
API with `npm run api-token`, add a header to each **Get Contents of URL**:
`Authorization` = `Bearer <your token>`.

## The recipes

| Shortcut | You say / press | Address | Then |
| --- | --- | --- | --- |
| **Tell the wall** | "Hey Siri, tell the wall" … "take out the bins every Monday and Thursday at 6pm" | `POST /api/tasks/say?format=text`, JSON body `{ "text": <Dictated Text> }` | Speak Text |
| **What's on the wall** | "Hey Siri, what's on the wall?" | `GET /api/tasks/brief?format=text` | Speak Text |
| **Wall done** | the Action button (Settings → Action Button → Shortcut) | `POST /api/tasks/next/done?format=text` | Show Notification |
| **Wall snooze** | "Hey Siri, wall snooze" | `POST /api/tasks/next/snooze?format=text`, optional `{ "minutes": 60 }` | Show Notification |

"Tell the wall" step by step:

1. New shortcut. Its name is what you say to Siri.
2. **Dictate Text**.
3. **Get Contents of URL** with the address. Under **Show More**: Method
   POST, Request Body JSON, a Text field `text` set to **Dictated Text**.
4. **Speak Text** with **Contents of URL**.

`?format=text` (or `Accept: text/plain`) makes the display answer with just
the sentence to speak, always with a 200, so Shortcuts never stops before
**Speak Text**. Without it you get JSON with the same sentence in `say`.
`/api/tasks/say` also accepts the dictated text as a raw `text/plain` body.

## What it understands

It knows the phrasings people actually say to a wall. It isn't a full date
parser.

| You say | You get |
| --- | --- |
| remind me to leave for practice in 20 minutes | alert, 20 minutes from now |
| take out the bins every Monday and Thursday at 6pm | weekly chore, Mon and Thu 6 PM |
| call the dentist tomorrow | chore, tomorrow 9 AM |
| meds every day at 8:30am | daily chore |
| vacuum every other week | chore, every 2 weeks |
| pay rent on the 1st every month | monthly chore |
| start dinner at 5 | chore, 5 PM today (a bare 1 to 6 reads as PM) |
| clean my room tonight | chore, 8 PM |

- Starting with "remind me", "alert me" or "ping me" makes an **alert**
  (it pops up at its time, then moves on). Anything else is a **chore**
  (it stays until someone marks it done).
- A day with no time is 9 AM. A time that has already passed today means
  tomorrow.
- A reminder with no time ("remind me to call mom") gets a question back,
  "When should I remind you to call mom?", and nothing is added.
- Items added this way show **Siri** as their source.

## The Action button

`/next/done` ticks off the most urgent item: the oldest overdue one, or if
nothing is overdue, the next one due today. The answer says what it did
and what's left: "Done: Take out the bins. Next time: Thursday at 6 PM. 1
more waiting."

A repeating chore moves to its next time, the same as tapping it on the
wall. The same shortcut works as a Lock Screen or Control Center button.
