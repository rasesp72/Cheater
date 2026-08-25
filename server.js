'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const {
  randomRoomCode,
  rollDice,
  createPlayer,
  createSpectator,
  createRoom,
  isLegalBid,
  resolveChallenge,
  applyDiscards,
} = require('./game');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

function serveStatic(req, res) {
  let urlPath = req.url === '/' ? '/index.html' : req.url;
  urlPath = urlPath.split('?')[0];
  const resolved = path.normalize(path.join(PUBLIC_DIR, urlPath));

  if (!resolved.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(resolved, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(resolved);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(serveStatic);
const wss = new WebSocketServer({ server });

/** @type {Map<string, ReturnType<typeof createRoom>>} */
const rooms = new Map();

function send(ws, type, payload) {
  if (ws && ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify({ type, payload }));
  }
}

function publicView(player) {
  return {
    id: player.id,
    name: player.name,
    connected: player.connected,
    diceCount: player.diceCount,
  };
}

function publicPlayerList(room) {
  return [...room.players.values()].map((p) => ({
    ...publicView(p),
    isHost: p.id === room.hostId,
  }));
}

function diceCounts(room) {
  const counts = {};
  for (const p of room.players.values()) counts[p.id] = p.diceCount;
  return counts;
}

function broadcast(room, type, payload, excludeId) {
  for (const player of room.players.values()) {
    if (player.id === excludeId) continue;
    send(player.ws, type, payload);
  }
  for (const spectator of room.spectators.values()) {
    if (spectator.id === excludeId) continue;
    send(spectator.ws, type, payload);
  }
}

function broadcastSpectatorCount(room, excludeId) {
  broadcast(room, 'spectator_count', { count: room.spectators.size }, excludeId);
}

function currentPlayerId(room) {
  return room.turnOrder[room.currentTurnIndex];
}

function advanceTurn(room) {
  room.currentTurnIndex = (room.currentTurnIndex + 1) % room.turnOrder.length;
}

function setTurnStarter(room, playerId) {
  const idx = room.turnOrder.indexOf(playerId);
  room.currentTurnIndex = idx === -1 ? 0 : idx;
}

function startRound(room) {
  room.currentBid = null;
  for (const player of room.players.values()) {
    player.dice = rollDice(player.diceCount);
    send(player.ws, 'your_dice', { dice: player.dice });
  }
  broadcast(room, 'round_started', {
    currentPlayerId: currentPlayerId(room),
    diceCounts: diceCounts(room),
  });
}

function handleCreateRoom(ws, payload) {
  const name = String(payload && payload.name || '').trim().slice(0, 24) || 'Player';
  const playerId = crypto.randomUUID();
  let code = randomRoomCode();
  while (rooms.has(code)) code = randomRoomCode();

  const room = createRoom(code, playerId);
  const player = createPlayer(playerId, name, ws);
  room.players.set(playerId, player);
  rooms.set(code, room);

  ws.roomCode = code;
  ws.playerId = playerId;

  send(ws, 'room_created', {
    roomCode: code,
    playerId,
    players: publicPlayerList(room),
    spectatorCount: room.spectators.size,
  });
}

function handleJoinRoom(ws, payload) {
  const code = String(payload && payload.roomCode || '').trim().toUpperCase();
  const name = String(payload && payload.name || '').trim().slice(0, 24) || 'Player';
  const room = rooms.get(code);

  if (!room) return send(ws, 'join_error', { reason: 'Room not found.' });
  if (room.phase !== 'lobby') return send(ws, 'join_error', { reason: 'Game already started.' });

  const playerId = crypto.randomUUID();
  const player = createPlayer(playerId, name, ws);
  room.players.set(playerId, player);

  ws.roomCode = code;
  ws.playerId = playerId;

  send(ws, 'joined_room', {
    roomCode: code,
    playerId,
    players: publicPlayerList(room),
    phase: room.phase,
    spectatorCount: room.spectators.size,
  });
  broadcast(room, 'lobby_update', { players: publicPlayerList(room) }, playerId);
}

function handleJoinSpectator(ws, payload) {
  const code = String(payload && payload.roomCode || '').trim().toUpperCase();
  const name = String(payload && payload.name || '').trim().slice(0, 24) || 'Spectator';
  const room = rooms.get(code);

  if (!room) return send(ws, 'join_error', { reason: 'Room not found.' });

  const spectatorId = crypto.randomUUID();
  const spectator = createSpectator(spectatorId, name, ws);
  room.spectators.set(spectatorId, spectator);

  ws.roomCode = code;
  ws.spectatorId = spectatorId;
  ws.isSpectator = true;

  send(ws, 'joined_spectator', {
    roomCode: code,
    spectatorId,
    players: publicPlayerList(room),
    phase: room.phase,
    spectatorCount: room.spectators.size,
    currentBid: room.currentBid,
    currentPlayerId: room.phase === 'playing' ? currentPlayerId(room) : null,
    diceCounts: diceCounts(room),
  });

  if (room.phase === 'gameover') {
    send(ws, 'game_over', {
      winnerIds: room.winnerIds,
      winnerNames: room.winnerIds.map((id) => room.players.get(id)?.name),
    });
  }

  broadcastSpectatorCount(room, spectatorId);
}

function handleRejoinRoom(ws, payload) {
  const code = String(payload && payload.roomCode || '').trim().toUpperCase();
  const playerId = String(payload && payload.playerId || '');
  const room = rooms.get(code);

  if (!room || !room.players.has(playerId)) {
    return send(ws, 'join_error', { reason: 'Could not rejoin — room or player not found.' });
  }

  const player = room.players.get(playerId);
  player.ws = ws;
  player.connected = true;
  ws.roomCode = code;
  ws.playerId = playerId;

  send(ws, 'joined_room', {
    roomCode: code,
    playerId,
    players: publicPlayerList(room),
    phase: room.phase,
    spectatorCount: room.spectators.size,
  });
  if (room.phase === 'playing' || room.phase === 'gameover') {
    send(ws, 'your_dice', { dice: player.dice });
    send(ws, 'game_started', {
      turnOrder: room.turnOrder,
      currentPlayerId: currentPlayerId(room),
      diceCounts: diceCounts(room),
    });
    if (room.currentBid) send(ws, 'bid_placed', { ...room.currentBid, nextPlayerId: currentPlayerId(room) });
    if (room.phase === 'gameover') {
      send(ws, 'game_over', {
        winnerIds: room.winnerIds,
        winnerNames: room.winnerIds.map((id) => room.players.get(id)?.name),
      });
    }
  }
  broadcast(room, 'player_reconnected', { playerId }, playerId);
}

function handleStartGame(ws) {
  const room = rooms.get(ws.roomCode);
  if (!room) return;
  if (ws.playerId !== room.hostId) return send(ws, 'error', { message: 'Only the host can start the game.' });
  if (room.players.size < 2) return send(ws, 'error', { message: 'Need at least 2 players to start.' });

  room.turnOrder = [...room.players.keys()];
  room.currentTurnIndex = 0;
  room.phase = 'playing';

  for (const player of room.players.values()) {
    player.dice = rollDice(player.diceCount);
    send(player.ws, 'your_dice', { dice: player.dice });
  }

  broadcast(room, 'game_started', {
    turnOrder: room.turnOrder,
    currentPlayerId: currentPlayerId(room),
    diceCounts: diceCounts(room),
  });
}

function handlePlaceBid(ws, payload) {
  const room = rooms.get(ws.roomCode);
  if (!room || room.phase !== 'playing') return;
  if (ws.playerId !== currentPlayerId(room)) {
    return send(ws, 'bid_error', { reason: 'It is not your turn.' });
  }

  const newBid = {
    quantity: Number(payload && payload.quantity),
    face: Number(payload && payload.face),
    playerId: ws.playerId,
  };

  if (!isLegalBid(room.currentBid, newBid)) {
    return send(ws, 'bid_error', { reason: 'That bid does not raise the previous one.' });
  }

  room.currentBid = newBid;
  advanceTurn(room);
  broadcast(room, 'bid_placed', { ...newBid, nextPlayerId: currentPlayerId(room) });
}

function handleChallenge(ws) {
  const room = rooms.get(ws.roomCode);
  if (!room || room.phase !== 'playing') return;
  if (ws.playerId !== currentPlayerId(room)) {
    return send(ws, 'bid_error', { reason: 'It is not your turn.' });
  }
  if (!room.currentBid) {
    return send(ws, 'bid_error', { reason: 'There is no bid to challenge yet.' });
  }

  const challengerId = ws.playerId;
  const bid = room.currentBid;
  const allPlayersDice = {};
  for (const p of room.players.values()) allPlayersDice[p.id] = p.dice;

  const result = resolveChallenge(bid, challengerId, allPlayersDice);
  const zeroed = applyDiscards(room.players, result.discardIds);

  broadcast(room, 'challenge_result', {
    challengerId,
    bidderId: bid.playerId,
    bid: { quantity: bid.quantity, face: bid.face },
    actualCount: result.actualCount,
    allDice: allPlayersDice,
    challengerWasRight: result.challengerWasRight,
    discardedPlayerIds: result.discardIds,
    diceCounts: diceCounts(room),
    nextRoundStarterId: result.nextRoundStarterId,
  });

  if (zeroed.length > 0) {
    room.phase = 'gameover';
    room.winnerIds = zeroed;
    broadcast(room, 'game_over', {
      winnerIds: zeroed,
      winnerNames: zeroed.map((id) => room.players.get(id)?.name),
    });
    return;
  }

  setTurnStarter(room, result.nextRoundStarterId);
  startRound(room);
}

function handleDisconnect(ws) {
  const room = rooms.get(ws.roomCode);
  if (!room) return;

  if (ws.isSpectator) {
    const spectator = room.spectators.get(ws.spectatorId);
    if (!spectator || spectator.ws !== ws) return; // a newer socket already replaced this one
    room.spectators.delete(ws.spectatorId);
    broadcastSpectatorCount(room);
    return;
  }

  const player = room.players.get(ws.playerId);
  if (!player || player.ws !== ws) return; // a newer socket already replaced this one
  player.connected = false;
  broadcast(room, 'player_disconnected', { playerId: ws.playerId });
  if (room.phase === 'lobby') {
    broadcast(room, 'lobby_update', { players: publicPlayerList(room) });
  }
}

const HANDLERS = {
  create_room: handleCreateRoom,
  join_room: handleJoinRoom,
  join_spectator: handleJoinSpectator,
  rejoin_room: handleRejoinRoom,
  start_game: handleStartGame,
  place_bid: handlePlaceBid,
  challenge: handleChallenge,
};

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return send(ws, 'error', { message: 'Malformed message.' });
    }
    const handler = HANDLERS[message.type];
    if (!handler) return send(ws, 'error', { message: `Unknown message type: ${message.type}` });
    handler(ws, message.payload);
  });

  ws.on('close', () => handleDisconnect(ws));
});

server.listen(PORT, () => {
  console.log(`Cheater server listening on http://localhost:${PORT}`);
});
