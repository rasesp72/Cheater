# Cheater

A browser-playable multiplayer version of the Danish bluffing dice game
"Tænkeboks" / "Løgn". Each player rolls dice hidden from everyone else, bids
on how many of a given face are out there across the whole table, and either
raises the bid or calls the bluff. Unlike Perudo, there's no elimination —
everyone keeps playing every round, and the **first player to get rid of all
their dice wins**.

## Rules

- Each player starts with **4 dice**, rerolled privately every round.
- Every bid names both a **quantity** and a **face (1–6)**. To raise the
  current bid you must either bid a **higher quantity** (any face), or the
  **same quantity with a higher face**.
- **1s are wild**: they count toward any other face's total. A bid *on* 1s
  only counts actual 1s (no double-wild bonus).
- On your turn you either raise the bid or **call cheat** on the previous
  bid. All dice are revealed:
  - If the actual count is **at least** the bid, the bidder told the truth —
    the challenger was wrong, and **everyone except the wrong challenger**
    discards one die.
  - If the actual count is **less than** the bid, the bidder lied — the
    challenger was right, and **everyone except the lying bidder**
    discards one die.
- Whoever was proven wrong (the caught liar, or the wrongful challenger)
  makes the first bid of the next round.
- The moment any player reaches **0 dice**, the game ends and they win. If
  two players hit zero in the same resolution, they're joint winners.

## Running locally

```bash
npm install
npm start
```

Then open `http://localhost:3000` in two or more browser tabs/windows (or
from other devices on the same network, using your machine's LAN IP instead
of `localhost`) to create a room in one tab and join it from the others.

## Tests

```bash
npm test
```

Runs the pure rules-logic unit tests (`game.test.js`) with Node's built-in
test runner — no server or browser needed.
