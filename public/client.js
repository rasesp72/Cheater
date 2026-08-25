'use strict';

const DIE_FACES = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

const state = {
  ws: null,
  roomCode: null,
  playerId: null,
  isSpectator: false,
  spectatorCount: 0,
  players: [], // [{id,name,connected,diceCount,isHost}]
  phase: 'join', // join | lobby | playing | gameover
  currentPlayerId: null,
  currentBid: null, // {quantity, face, playerId}
  yourDice: [],
};

function setPhase(phase) {
  state.phase = phase;
  document.body.dataset.phase = phase;
}

function send(type, payload) {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify({ type, payload }));
  }
}

function connect() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${protocol}//${location.host}`);
  state.ws = ws;

  ws.addEventListener('open', () => {
    const saved = loadSession();
    if (saved) {
      send('rejoin_room', saved);
    }
  });

  ws.addEventListener('message', (event) => {
    const { type, payload } = JSON.parse(event.data);
    const handler = MESSAGE_HANDLERS[type];
    if (handler) handler(payload);
  });

  ws.addEventListener('close', () => {
    showJoinError('Connection lost. Reload to reconnect.');
  });
}

function saveSession(roomCode, playerId) {
  localStorage.setItem('cheater_session', JSON.stringify({ roomCode, playerId }));
}

function loadSession() {
  try {
    const raw = localStorage.getItem('cheater_session');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function clearSession() {
  localStorage.removeItem('cheater_session');
}

// ---------- Rendering ----------

function renderLobby() {
  els.lobbyRoomCode.textContent = state.roomCode;
  els.lobbyPlayerList.innerHTML = '';
  for (const p of state.players) {
    const li = document.createElement('li');
    li.textContent = `${p.name}${p.isHost ? ' (host)' : ''}${p.connected ? '' : ' — disconnected'}`;
    els.lobbyPlayerList.appendChild(li);
  }
  const me = state.players.find((p) => p.id === state.playerId);
  const isHost = me && me.isHost;
  els.startGameBtn.hidden = !isHost;
  els.startGameBtn.disabled = state.players.length < 2;
  els.lobbyWaitingText.hidden = !!isHost;
  els.lobbyWaitingText.textContent = state.isSpectator
    ? "You're spectating — waiting for the host to start…"
    : 'Waiting for the host to start…';
  renderSpectatorCount();
}

function renderSpectatorCount() {
  if (state.spectatorCount > 0) {
    els.spectatorCountDisplay.textContent = `👀 ${state.spectatorCount} watching`;
    els.spectatorCountDisplay.hidden = false;
  } else {
    els.spectatorCountDisplay.hidden = true;
  }
}

function turnText() {
  const current = state.players.find((p) => p.id === state.currentPlayerId);
  const name = current ? current.name : '?';
  return state.currentBid
    ? `Waiting on ${name} to bid or call cheat.`
    : `Waiting on ${name} to open the round.`;
}

function renderSpectatorTable() {
  if (!state.isSpectator) return;
  els.spectatorTable.innerHTML = '';

  const surface = document.createElement('div');
  surface.className = 'table-surface';

  const center = document.createElement('div');
  center.className = 'table-center';

  const bidLabel = document.createElement('div');
  bidLabel.className = 'hint';
  bidLabel.textContent = 'Current bid';

  const bidValue = document.createElement('div');
  bidValue.className = 'table-bid-text';
  bidValue.textContent = state.currentBid
    ? `${state.currentBid.quantity} × ${DIE_FACES[state.currentBid.face]}`
    : 'No bid yet';

  center.appendChild(bidLabel);
  center.appendChild(bidValue);

  if (state.phase === 'playing') {
    const turnInfo = document.createElement('div');
    turnInfo.className = 'table-turn-text';
    turnInfo.textContent = turnText();
    center.appendChild(turnInfo);
  }

  surface.appendChild(center);
  els.spectatorTable.appendChild(surface);

  const n = state.players.length;
  state.players.forEach((p, i) => {
    const angle = (360 / n) * i - 90;
    const rad = (angle * Math.PI) / 180;
    const x = 50 + 42 * Math.cos(rad);
    const y = 50 + 42 * Math.sin(rad);

    const seat = document.createElement('div');
    seat.className = 'table-seat';
    if (p.id === state.currentPlayerId) seat.classList.add('current-turn');
    if (!p.connected) seat.classList.add('disconnected');
    seat.style.left = `${x}%`;
    seat.style.top = `${y}%`;

    const dice = document.createElement('div');
    dice.className = 'seat-dice';
    dice.textContent = '🎲'.repeat(p.diceCount);

    const name = document.createElement('div');
    name.className = 'seat-name';
    name.textContent = p.name + (p.isHost ? ' (host)' : '');

    seat.appendChild(dice);
    seat.appendChild(name);
    els.spectatorTable.appendChild(seat);
  });
}

function renderPlayerStrip() {
  els.playerStrip.innerHTML = '';
  for (const p of state.players) {
    const chip = document.createElement('div');
    chip.className = 'player-chip';
    if (p.id === state.currentPlayerId) chip.classList.add('current-turn');
    if (!p.connected) chip.classList.add('disconnected');
    chip.innerHTML = `<span class="conn-dot"></span> ${p.name} — ${p.diceCount} 🎲`;
    els.playerStrip.appendChild(chip);
  }
  renderSpectatorTable();
}

function renderBid() {
  if (!state.currentBid) {
    els.currentBidText.textContent = 'No bid yet — opening round';
  } else {
    const b = state.currentBid;
    const bidder = state.players.find((p) => p.id === b.playerId);
    els.currentBidText.textContent = `${b.quantity} × ${DIE_FACES[b.face]} (by ${bidder ? bidder.name : '?'})`;
  }
}

function renderYourDice() {
  els.yourDiceRow.innerHTML = '';
  for (const d of state.yourDice) {
    const die = document.createElement('div');
    die.className = 'die';
    die.textContent = DIE_FACES[d];
    els.yourDiceRow.appendChild(die);
  }
}

function isLegalBidClient(prevBid, newBid) {
  if (newBid.face < 1 || newBid.face > 6 || newBid.quantity < 1) return false;
  if (!prevBid) return true;
  if (newBid.quantity > prevBid.quantity) return true;
  if (newBid.quantity === prevBid.quantity) return newBid.face > prevBid.face;
  return false;
}

function renderTurnAndControls() {
  const isYourTurn = !state.isSpectator && state.currentPlayerId === state.playerId;
  els.turnBanner.hidden = !isYourTurn;
  if (isYourTurn) els.turnBanner.textContent = "It's your turn!";

  els.bidControls.hidden = state.isSpectator || state.phase !== 'playing';
  els.placeBidBtn.disabled = !isYourTurn;
  els.challengeBtn.disabled = !isYourTurn || !state.currentBid;

  const quantity = Number(els.bidQuantity.value);
  const face = Number(els.bidFace.value);
  const legal = isLegalBidClient(state.currentBid, { quantity, face });
  els.placeBidBtn.disabled = !isYourTurn || !legal;

  renderSpectatorTable();
}

function showJoinError(msg) {
  els.joinError.textContent = msg;
  els.joinError.hidden = false;
}

function showGameError(msg) {
  els.gameError.textContent = msg;
  els.gameError.hidden = false;
  setTimeout(() => { els.gameError.hidden = true; }, 3000);
}

function showReveal(payload) {
  const bidder = state.players.find((p) => p.id === payload.bidderId);
  const challenger = state.players.find((p) => p.id === payload.challengerId);
  const bidText = `${payload.bid.quantity} × ${DIE_FACES[payload.bid.face]}`;

  els.revealTitle.textContent = payload.challengerWasRight
    ? `${bidder ? bidder.name : '?'} was bluffing!`
    : `${bidder ? bidder.name : '?'} told the truth!`;

  els.revealDice.innerHTML = '';
  for (const [playerId, dice] of Object.entries(payload.allDice)) {
    const p = state.players.find((pl) => pl.id === playerId);
    const group = document.createElement('div');
    group.className = 'die-group';
    const label = document.createElement('div');
    label.className = 'die-group-name';
    label.textContent = p ? p.name : playerId;
    group.appendChild(label);
    const row = document.createElement('div');
    row.className = 'dice-row';
    for (const d of dice) {
      const die = document.createElement('div');
      die.className = 'die';
      die.textContent = DIE_FACES[d];
      row.appendChild(die);
    }
    group.appendChild(row);
    els.revealDice.appendChild(group);
  }

  const discardedNames = payload.discardedPlayerIds
    .map((id) => (state.players.find((p) => p.id === id) || {}).name || id)
    .join(', ');

  els.revealDetail.textContent =
    `Claimed ${bidText}; actual count was ${payload.actualCount}. ` +
    `${challenger ? challenger.name : '?'} ${payload.challengerWasRight ? 'was right' : 'was wrong'} to challenge. ` +
    `${discardedNames} discard${payload.discardedPlayerIds.length === 1 ? 's' : ''} a die.`;

  els.revealOverlay.hidden = false;
}

// ---------- Message handlers ----------

const MESSAGE_HANDLERS = {
  room_created(payload) {
    state.roomCode = payload.roomCode;
    state.playerId = payload.playerId;
    state.players = payload.players;
    state.spectatorCount = payload.spectatorCount || 0;
    saveSession(state.roomCode, state.playerId);
    setPhase('lobby');
    renderLobby();
  },

  joined_room(payload) {
    state.roomCode = payload.roomCode;
    state.playerId = payload.playerId;
    state.players = payload.players;
    state.spectatorCount = payload.spectatorCount || 0;
    saveSession(state.roomCode, state.playerId);
    if (payload.phase === 'lobby') {
      setPhase('lobby');
      renderLobby();
    } else if (payload.phase === 'playing') {
      setPhase('playing');
    } else if (payload.phase === 'gameover') {
      setPhase('gameover');
    }
    renderSpectatorCount();
  },

  joined_spectator(payload) {
    state.isSpectator = true;
    state.roomCode = payload.roomCode;
    state.playerId = null;
    state.players = payload.players;
    state.currentBid = payload.currentBid;
    state.currentPlayerId = payload.currentPlayerId;
    state.spectatorCount = payload.spectatorCount || 0;
    for (const p of state.players) {
      if (payload.diceCounts[p.id] !== undefined) p.diceCount = payload.diceCounts[p.id];
    }
    document.body.dataset.role = 'spectator';

    if (payload.phase === 'lobby') {
      setPhase('lobby');
      renderLobby();
    } else if (payload.phase === 'playing') {
      setPhase('playing');
      renderPlayerStrip();
      renderBid();
      renderTurnAndControls();
    } else if (payload.phase === 'gameover') {
      setPhase('gameover');
    }
    renderSpectatorCount();
  },

  spectator_count(payload) {
    state.spectatorCount = payload.count;
    renderSpectatorCount();
  },

  join_error(payload) {
    clearSession();
    showJoinError(payload.reason);
  },

  lobby_update(payload) {
    state.players = payload.players;
    if (state.phase === 'lobby') renderLobby();
  },

  game_started(payload) {
    state.currentPlayerId = payload.currentPlayerId;
    for (const p of state.players) {
      if (payload.diceCounts[p.id] !== undefined) p.diceCount = payload.diceCounts[p.id];
    }
    state.currentBid = null;
    setPhase('playing');
    renderPlayerStrip();
    renderBid();
    renderTurnAndControls();
  },

  your_dice(payload) {
    state.yourDice = payload.dice;
    renderYourDice();
  },

  bid_placed(payload) {
    state.currentBid = { quantity: payload.quantity, face: payload.face, playerId: payload.playerId };
    state.currentPlayerId = payload.nextPlayerId;
    renderBid();
    renderTurnAndControls();
  },

  bid_error(payload) {
    showGameError(payload.reason);
  },

  challenge_result(payload) {
    for (const p of state.players) {
      if (payload.diceCounts[p.id] !== undefined) p.diceCount = payload.diceCounts[p.id];
    }
    renderPlayerStrip();
    showReveal(payload);
  },

  round_started(payload) {
    // Note: deliberately does NOT hide the reveal overlay — challenge_result and
    // round_started arrive back-to-back, and the player needs the "Continue"
    // button click to be what dismisses the reveal, or they'd never see it.
    state.currentBid = null;
    state.currentPlayerId = payload.currentPlayerId;
    for (const p of state.players) {
      if (payload.diceCounts[p.id] !== undefined) p.diceCount = payload.diceCounts[p.id];
    }
    renderPlayerStrip();
    renderBid();
    renderTurnAndControls();
  },

  player_disconnected(payload) {
    const p = state.players.find((pl) => pl.id === payload.playerId);
    if (p) p.connected = false;
    if (state.phase === 'lobby') renderLobby(); else renderPlayerStrip();
  },

  player_reconnected(payload) {
    const p = state.players.find((pl) => pl.id === payload.playerId);
    if (p) p.connected = true;
    if (state.phase === 'lobby') renderLobby(); else renderPlayerStrip();
  },

  game_over(payload) {
    // Leave the reveal overlay (if open) up — the player dismisses it with
    // "Continue" and sees the game-over screen underneath.
    setPhase('gameover');
    const names = payload.winnerNames.filter(Boolean);
    els.gameoverText.textContent = names.length > 1
      ? `${names.join(' and ')} reached zero dice at the same time — joint winners!`
      : `${names[0] || 'A player'} reached zero dice and wins!`;
    clearSession();
  },

  error(payload) {
    showGameError(payload.message);
  },
};

// ---------- DOM wiring ----------

const els = {
  nameInput: document.getElementById('name-input'),
  createRoomBtn: document.getElementById('create-room-btn'),
  roomCodeInput: document.getElementById('room-code-input'),
  joinRoomBtn: document.getElementById('join-room-btn'),
  spectateBtn: document.getElementById('spectate-btn'),
  joinError: document.getElementById('join-error'),
  spectatorCountDisplay: document.getElementById('spectator-count-display'),
  spectatorTable: document.getElementById('spectator-table'),

  lobbyRoomCode: document.getElementById('lobby-room-code'),
  lobbyPlayerList: document.getElementById('lobby-player-list'),
  startGameBtn: document.getElementById('start-game-btn'),
  lobbyWaitingText: document.getElementById('lobby-waiting-text'),

  playerStrip: document.getElementById('player-strip'),
  currentBidText: document.getElementById('current-bid-text'),
  yourDiceRow: document.getElementById('your-dice'),
  turnBanner: document.getElementById('turn-banner'),
  bidControls: document.getElementById('bid-controls'),
  bidQuantity: document.getElementById('bid-quantity'),
  bidFace: document.getElementById('bid-face'),
  placeBidBtn: document.getElementById('place-bid-btn'),
  challengeBtn: document.getElementById('challenge-btn'),
  gameError: document.getElementById('game-error'),

  gameoverTitle: document.getElementById('gameover-title'),
  gameoverText: document.getElementById('gameover-text'),
  playAgainBtn: document.getElementById('play-again-btn'),

  revealOverlay: document.getElementById('reveal-overlay'),
  revealTitle: document.getElementById('reveal-title'),
  revealDice: document.getElementById('reveal-dice'),
  revealDetail: document.getElementById('reveal-detail'),
  revealContinueBtn: document.getElementById('reveal-continue-btn'),
};

els.createRoomBtn.addEventListener('click', () => {
  els.joinError.hidden = true;
  send('create_room', { name: els.nameInput.value });
});

els.joinRoomBtn.addEventListener('click', () => {
  els.joinError.hidden = true;
  send('join_room', { roomCode: els.roomCodeInput.value.trim().toUpperCase(), name: els.nameInput.value });
});

els.spectateBtn.addEventListener('click', () => {
  els.joinError.hidden = true;
  send('join_spectator', { roomCode: els.roomCodeInput.value.trim().toUpperCase(), name: els.nameInput.value });
});

els.startGameBtn.addEventListener('click', () => {
  send('start_game', {});
});

els.placeBidBtn.addEventListener('click', () => {
  send('place_bid', { quantity: Number(els.bidQuantity.value), face: Number(els.bidFace.value) });
});

els.challengeBtn.addEventListener('click', () => {
  send('challenge', {});
});

els.bidQuantity.addEventListener('input', renderTurnAndControls);
els.bidFace.addEventListener('change', renderTurnAndControls);

els.revealContinueBtn.addEventListener('click', () => {
  els.revealOverlay.hidden = true;
});

els.playAgainBtn.addEventListener('click', () => {
  location.reload();
});

connect();
