# Siri, the Action button and Shortcuts

Talk to the wall without opening anything. Each recipe below is a short
shortcut in Apple's **Shortcuts** app pointed at the display. The phone
remote has the same recipes with your display's address already filled in:
**Tasks → Siri & Shortcuts** (`/remote/shortcuts`). That page also has a
**Try a phrase** box, so you can check how the wall understands a sentence
before you set up Siri.

Use the **Tailscale** address (the phone page shows it as a chip under "Address
for your shortcuts") if you want Siri to work away from home. The home Wi-Fi
address only works at home. If you locked the
API with `npm run api-token`, add a header to each **Get Contents of URL**:
`Authorization` = `Bearer <your token>`.

## The recipes

| Shortcut | You say / press | What it does |
| --- | --- | --- |
| **Wall** (menu) | the Action button | A list of what you can do right now, with **Tell the wall** at the top |
| **Wall press** | Back Tap (double-tap the back of the phone) | Does the obvious thing, no list |
| **Tell the wall** | "Hey Siri, tell the wall" … | Adds a chore, alert or timer, or runs a command |
| **Automations** | nothing: they run by themselves (alarm stops, arrive home, a time of day) | Morning, leaving, home and night briefings, spoken |
| **What's on the wall** | "Hey Siri, what's on the wall?" | Reads out what's waiting and what's next |

### Wall (the Action button)

The menu is rebuilt every press from what's on the wall:

- **Tell the wall**: dictate a sentence (same as the Siri shortcut)
- **Allow: git push … / Deny: …**: when an agent is waiting
- **Read me the board / Leaving now (School)**: when a departure is on
- **Done: Feed the cat**: up to three things waiting or due today
- **Snooze 1 h: …**: the most urgent waiting item
- **What's waiting?**
- **Pause music / Next song**, or **Play …** when paused
- **Show the weather / Show the clock**
- **Screen off / Screen on**

Build it once:

1. **Get Contents of URL**: `GET /api/action/menu?format=text` (one label per line).
2. **Split Text** by **New Lines**, then **Choose from List**.
3. **If** Chosen Item **is** `Tell the wall`:
   - **Dictate Text**
   - **Get Contents of URL**: `POST /api/tasks/say?format=text`, JSON `{ "text": <Dictated Text> }`
   - **Speak Text**
4. **Otherwise**:
   - **Get Contents of URL**: `POST /api/action/run?format=text`, JSON `{ "choice": <Chosen Item> }`
   - **Show Notification**
5. Settings → **Action Button** → Shortcut → **Wall**.

Every action flashes on the wall's island ("Done: Feed the cat", source
iPhone) so you can see the press land.

### Wall press (Back Tap)

`POST /api/action?format=text`, then **Speak Text**. One press picks, in order:

1. **An agent is waiting**: it reads the request out. It never allows it
   by itself; answer from the menu, the wall or the phone.
2. **A departure is on**: it reads the board ("Leave for school in 6
   minutes. Bring PE kit and umbrella. First: feed the cat.") and brings
   the board up on the wall.
3. **Something is overdue**: it ticks off the most urgent item.
4. **Otherwise**: it reads out what's waiting and what's next.

Settings → Accessibility → Touch → **Back Tap** → Double Tap → **Wall press**.

### Tell the wall

1. **Dictate Text**.
2. **Get Contents of URL**: `POST /api/tasks/say?format=text`, JSON
   `{ "text": <Dictated Text> }`.
3. **Speak Text**.
4. **If** Contents of URL **ends with** `?`: **Dictate Text**, the same
   **Get Contents of URL** with the new Dictated Text, then **Speak Text**.

Step 4 lets you answer when the wall asks back. The wall remembers its
question for 2 minutes, so the answer can be just the missing part:

> **You:** remind me to call mom
> **Wall:** When should I remind you to call mom?
> **You:** at five
> **Wall:** Reminder set: Call mom, today at 5 PM.

Say "never mind" to drop it. A new full sentence replaces the question,
and after 2 minutes it's forgotten. Without step 4, just say the whole
thing again with a time.

### What's on the wall

`GET /api/tasks/brief?format=text`, then **Speak Text**.

`?format=text` (or `Accept: text/plain`) makes the display answer with just
the sentence, always with a 200, so Shortcuts never stops before **Speak
Text**. Without it you get JSON with the same sentence in `say`.
`/api/tasks/say` and `/api/action/run` also accept a raw `text/plain` body.
The older `/api/tasks/next/done` and `/next/snooze` still work.

## Commands

"Tell the wall" runs these instead of adding them:

| You say | It does |
| --- | --- |
| I'm done with the bins / the laundry is done / mark feed the cat done | ticks off the closest match ("bins" finds "Take out the bins") |
| snooze the cat for 2 hours / snooze the plants until tomorrow | snoozes it (default 1 hour) |
| what's on the wall / what's next / what do I have | reads the brief |
| I'm leaving / what do I need to bring | reads the departure board and shows it |
| show me the weather / radar / music / school / clock | switches the wall's view |
| pause / play / next song / previous song | music |
| goodnight / screen off · good morning / screen on | the panel |
| allow it / deny it | answers a waiting agent |
| undo that / scratch that / oops | takes back the last thing a voice command or the Action button did (see below) |
| what's the weather / will it rain / do I need an umbrella | reads the weather, the high, and when rain is likely |
| what's tomorrow / what do I have tomorrow | reads tomorrow's items |
| set a timer for 10 minutes / pasta timer 12 minutes | an alert that pops up on the wall when it's up |
| how long is left on the timer | reads the timers that are running |
| cancel the timer | cancels them |

Anything starting with "remind me", "add", "I need to" is always added,
never treated as a command.

## Hands-off

Everything above can be done by voice alone, so it works with AirPods and
CarPlay (and should on an Apple Watch, which runs the same shortcuts; I
haven't tried those two myself).

**Automations.** In the Shortcuts app, the **Automation** tab can run a
shortcut for you when something happens. Each of these is one **Get Contents
of URL** (POST) followed by **Speak Text**. Choose **Run Immediately** where
iOS offers it, so nothing asks first.

| Automation | Trigger | URL | What you hear |
| --- | --- | --- | --- |
| Morning | **Alarm**: when it stops | `/api/action/event/morning?format=text` | The wall's screen comes on. "Good morning. Leave for school in 40 minutes. Bring PE kit and umbrella. It's 58 degrees and clear. High of 72 today. One thing waiting: Feed the cat." |
| Leaving | **Leave** your home, or CarPlay connecting | `/api/action/event/leaving?format=text` | The departure board read out, or what's still waiting |
| Home | **Arrive** home | `/api/action/event/home?format=text` | "Welcome home." Then what's waiting. The screen comes on |
| Night | **Time of Day**, say 10:00 pm | `/api/action/event/night?format=text` | "Tomorrow: Leave for school at 7:40 AM and Dentist at 3 PM. Good night." Then the screen goes off |

**Timers.** "Hey Siri, tell the wall" … "set a pasta timer for twelve
minutes". The wall pops up when it's up. You can also ask how long is left,
or cancel it.

## When something goes wrong

- **Say it twice, get it once.** If Siri or Shortcuts sends the same request
  again, the wall answers "Already on the list" and doesn't add a second
  copy. Two minutes later it counts as a new request.
- **Undo.** Say "undo that" (or pick **Undo: …** in the Wall menu) and the
  last add, tick-off or snooze done by voice or the Action button is taken
  back. It remembers up to five, for ten minutes. Things you do by tapping
  the wall or the phone aren't undone by voice.
- **Slow lookups can't stall you.** The weather and calendar are cached for
  ten minutes, and a lookup that takes over two and a half seconds is skipped,
  so a press always answers fast.
- **Misheard words.** Fillers ("um", "okay"), "can you please…" and "set a
  reminder to…" are ignored, and number words work ("in two minutes").
  When the wall still can't tell what you want, it asks, and you can answer
  (step 4 of Tell the wall).
- **Display off or out of range.** Shortcuts shows its own error and stops.
  Nothing is lost, and nothing was added. If that happens at home, check the
  address under "Address for your shortcuts" on the phone page.
- **The Action button tick-off has no confirmation**, so a wrong press is one
  "undo that" away.

## Alerts on your phone

Alerts that pop up on the wall can also reach your phone, so you get them when
you're away from it. The wall can post a plain-text message to a push service
like [ntfy](https://ntfy.sh) (a free app, with iOS and Android versions):

```bash
curl -X POST http://<kiosk>:3000/api/webhooks \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://ntfy.sh/pick-a-long-random-topic","events":["task.due"],"format":"text","name":"My phone"}'
```

Then install ntfy on your phone and subscribe to the same topic. Anyone who
knows a topic name can read and send to it, and the message contains your
chore titles, so pick a long random name or run your own ntfy server.
Alerts arrive as high priority and chores as normal. Add `"task.done"` to
`events` to hear about completions too.

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
  "When should I remind you to call mom?". Nothing is added until you
  answer (see step 4 above).
- Numbers can be words or digits: "in two minutes", "at five thirty pm",
  "in a couple of hours" and "at seven o'clock" all work.
- Items added this way show **Siri** as their source.

## The older Action button endpoint

`/next/done` ticks off the most urgent item: the oldest overdue one, or if
nothing is overdue, the next one due today. The answer says what it did
and what's left: "Done: Take out the bins. Next time: Thursday at 6 PM. 1
more waiting."

A repeating chore moves to its next time, the same as tapping it on the
wall. The same shortcut works as a Lock Screen or Control Center button.
