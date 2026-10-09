# Scoundrel

A browser version of **Scoundrel**, a solo dungeon-crawl card game played with a standard deck (originally designed by Zach Gage and Kurt Bieg). You fight through a 44-card dungeon of monsters, weapons and potions, one room at a time.

It's written in plain HTML, CSS and JavaScript. There are no dependencies, no build step and no server.

## Features

- The full rule set: avoiding rooms, carrying a card into the next room, one potion per room, and weapons that can only be used on smaller and smaller monsters.
- **Seeded shuffles.** Each dungeon comes from a seed, and **Restart** replays the exact same deck order.
- **Saves automatically.** Every action is stored in LocalStorage, so a reload picks up where you left off.
- **Previews before you act.** Each card's buttons show the damage or healing it will cause, and flag moves that would kill you.
- **Accessible.** You can play entirely by keyboard. Focus styles are visible, the action log is an ARIA live region, buttons have descriptive labels, and `prefers-reduced-motion` is respected.
- **Responsive.** Four cards in a row on desktop, a 2×2 grid on phones.
- **Extras.** A rules dialog with worked examples, a score screen with your best score and win count, and a debug panel (hidden by default) for seeds and deck order.

## How to run

1. Download or clone the project.
2. Open `index.html` in any modern browser.

The scripts are plain `<script>` files rather than ES modules, so the game works when opened straight from disk (`file://`). To serve it locally instead:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

Add `?debug` to the URL to open the debug panel at load.

## Rules

### The dungeon

Start with a 52-card deck and remove the jokers, the red face cards and the red aces. That leaves 44 cards, shuffled to form the dungeon:

| Cards | Role | Values |
| --- | --- | --- |
| ♣ ♠ 2–A (26) | Monsters | 2–10, J 11, Q 12, K 13, A 14 |
| ♦ 2–10 (9) | Weapons | 2–10 |
| ♥ 2–10 (9) | Potions | 2–10 |

You start with 20 health, which is also the maximum.

### Rooms

Each turn, draw until 4 cards are face up. This is the **room**. Then choose:

- **Avoid it.** Put all 4 cards on the bottom of the dungeon, in order. You can't avoid two rooms in a row, and you can't avoid once you've started resolving cards.
- **Face it.** Resolve 3 of the 4 cards in any order. The 4th card stays and becomes the first card of the next room.

### Resolving cards

- **Weapon (♦).** Equip it immediately. Your previous weapon is discarded along with every monster stacked on it.
- **Potion (♥).** Heal by its value, up to 20. Only the first potion you use in a room heals; any other potion in that room is discarded with no effect.
- **Monster (♣ ♠).**
  - *Bare-handed:* take damage equal to the monster's value.
  - *With a weapon:* take `monster − weapon` damage (minimum 0). The monster is stacked on the weapon, and its value becomes the weapon's **last defeated** value.

**The weapon only goes down.** Once a weapon has slain a monster, it can only be used on monsters with a value less than or equal to the last one it slew.

> Equip ♦5 and fight ♠J (11): take 6 damage, and last defeated becomes 11.
> Fight ♣6: 6 ≤ 11, so take 1 damage, and last defeated becomes 6.
> Then ♠8 appears: 8 > 6, so ♦5 can't be used and you take 8 bare-handed.

You can always choose to fight bare-handed, which keeps your weapon's chain high for a bigger monster later.

### Ending and score

- **Win:** clear every card in the dungeon. Your score is your remaining health.
- **Loss:** your health reaches 0. Your score is minus the total value of the monsters still in the dungeon and the room.

When the dungeon runs out, the last room may have fewer than 4 cards. You resolve all of them to win.

## Controls

| Input | Action |
| --- | --- |
| <kbd>1</kbd>–<kbd>4</kbd> | Use the card in that slot (with your weapon, if it can be used) |
| <kbd>Shift</kbd> + <kbd>1</kbd>–<kbd>4</kbd> | Fight that monster bare-handed |
| <kbd>A</kbd> | Avoid the room |
| <kbd>N</kbd> | New game (new seed) |
| <kbd>R</kbd> | Restart this dungeon (same seed) |
| <kbd>H</kbd> or <kbd>?</kbd> | Rules |
| <kbd>Esc</kbd> | Close a dialog |
| <kbd>Tab</kbd> | Move between every control and card action |

New game and Restart ask for confirmation while a run is in progress.

## Project structure

```
scoundrel-game/
├── index.html        Page structure: HUD, room, action log, debug panel, dialogs
├── favicon.svg
├── css/
│   └── styles.css    Theme variables, responsive layout, cards, HUD, animations, reduced motion
└── js/
    ├── rng.js        Seeded PRNG (mulberry32), Fisher–Yates shuffle, seed codes
    ├── deck.js       Card model, building the 44-card dungeon, card labels
    ├── game.js       Rules engine (no DOM): state, rooms, avoid, resolving cards, win/loss, score
    ├── storage.js    LocalStorage save/load and score records, all guarded with try/catch
    ├── render.js     State → DOM: HUD, room cards and actions, log, debug panel, feedback
    └── main.js       Controller: input, keyboard shortcuts, dialogs, focus management, startup
```

Each script attaches itself to a single `window.Scoundrel` namespace, and they load in the order above.

### Design notes

- **`game.js` has no DOM code.** Each action changes a plain, JSON-serialisable state object and returns a result (`{ type, damage, heal, newRoom, ... }`) that the UI uses for feedback. This makes the rules easy to test outside a browser, and the state can be saved to LocalStorage unchanged.
- **Card actions come from the rules.** `game.cardActions(state, slot)` lists the legal moves for a card along with their damage or healing. The buttons and the keyboard shortcuts both use it, so the UI can't offer a move the rules would reject.
- **Only new events are announced.** The action log adds entries rather than redrawing, so screen readers announce each event once. Only newly dealt cards play the flip animation.
- **The tricky rules have worked examples in the code.** See `canUseWeapon` and `usePotion` in `js/game.js`.

### Rule interpretations

- Fighting with a weapon always kills the monster and adds it to the weapon's stack, even if you still take damage, as in the original game. Otherwise a weapon would never wear down against stronger monsters.
- The loss score counts monsters still in the room as well as those in the dungeon.
- You can't avoid a room once the dungeon is empty, because you'd just draw the same cards again.
