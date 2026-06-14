const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};

const CARD_TEMPLATES = {
  question: [
    { id: 'q1', type: 'question', title: 'Rahasia Terbesar', text: 'Ceritakan satu rahasia yang belum pernah kamu ceritakan ke siapapun di sini.' },
    { id: 'q2', type: 'question', title: 'Moment Memalukan', text: 'Apa momen paling memalukan dalam hidupmu yang masih kamu ingat jelas?' },
    { id: 'q3', type: 'question', title: 'Berbohong', text: 'Kapan terakhir kamu berbohong ke seseorang di grup ini? Tentang apa?' },
    { id: 'q4', type: 'question', title: 'Siapa yang paling...', text: 'Dari semua orang di call ini, siapa yang menurutmu paling susah dibaca pikirannya?' },
    { id: 'q5', type: 'question', title: 'DM Tersembunyi', text: 'Pernah chat seseorang di sini secara pribadi hal yang tidak pernah kamu bahas di grup?' },
    { id: 'q6', type: 'question', title: 'Kesan Pertama', text: 'Apa kesan pertamamu terhadap salah satu orang di sini? Siapa dan apa?' },
    { id: 'q7', type: 'question', title: 'Nilai Asli', text: 'Jika ada yang tanya nilai ujianmu yang paling buruk sepanjang hidup, berapa?' },
    { id: 'q8', type: 'question', title: 'Konfesi', text: 'Pernah melakukan sesuatu yang kamu tahu salah tapi tidak pernah mengakuinya?' },
    { id: 'q9', type: 'question', title: 'Kalau Jujur', text: 'Siapa di grup ini yang paling sering kamu judge dalam hati tapi tidak pernah bilang?' },
    { id: 'q10', type: 'question', title: 'Plot Twist', text: 'Satu hal tentang dirimu yang paling mengejutkan jika orang-orang di sini tahu.' },
  ],
  expose: [
    { id: 'e1', type: 'expose', title: 'Kartu Expose', text: 'Target harus perlihatkan 1 kartu dari tangannya ke semua orang selama 4 detik.' },
    { id: 'e2', type: 'expose', title: 'Kartu Expose+', text: 'Target harus perlihatkan 2 kartu dari tangannya ke semua orang. Tidak bisa ditolak.' },
    { id: 'e3', type: 'expose', title: 'Expose Pilihan', text: 'Kamu yang pilih kartu mana dari tangan target yang harus diperlihatkan ke semua.' },
  ],
  shield: [
    { id: 's1', type: 'shield', title: 'Perisai Balik', text: 'Tolak kartu apapun yang masuk. Kartu itu kembali ke pengirim — dan efeknya berlaku ke mereka.' },
    { id: 's2', type: 'shield', title: 'Perisai Besi', text: 'Kebal dari semua kartu ronde ini. Tidak ada yang bisa menyentuhmu.' },
    { id: 's3', type: 'shield', title: 'Perisai Cermin', text: 'Jika kartu Pertanyaan datang, kamu balik pertanyaan yang sama ke pengirimnya.' },
  ],
  bomb: [
    { id: 'b1', type: 'bomb', title: 'Bom Waktu', text: 'Meledak dalam 25 detik. Oper ke orang lain atau kena −5 poin. Hanya bisa dioper sekali.' },
    { id: 'b2', type: 'bomb', title: 'Bom Karir', text: 'Meledak dalam 20 detik. Siapapun yang pegang terakhir harus jawab Kartu Pertanyaan paling berat dari deck.' },
    { id: 'b3', type: 'bomb', title: 'Bom Berantai', text: 'Meledak dalam 30 detik — tapi saat dioper, pengirim asli ikut kena setengah damage.' },
  ],
  curse: [
    { id: 'c1', type: 'curse', title: 'Kutukan Tersembunyi', text: '???', reveal: 'Kutukan Buruk: Kamu tidak bisa pakai Perisai ronde berikutnya. −2 poin.', effect: -2 },
    { id: 'c2', type: 'curse', title: 'Kutukan Tersembunyi', text: '???', reveal: 'Kejutan Bonus: Kutukan ini ternyata memberimu +4 poin!', effect: 4 },
    { id: 'c3', type: 'curse', title: 'Kutukan Tersembunyi', text: '???', reveal: 'Kutukan Swap: Kartu terbaikmu diacak ke pemain lain secara diam-diam.', effect: -1 },
    { id: 'c4', type: 'curse', title: 'Kutukan Tersembunyi', text: '???', reveal: 'Kutukan Keberuntungan: Kamu mendapat kartu tambahan dari deck!', effect: 3 },
  ]
};

function generateRoomCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildDeck() {
  const deck = [];
  Object.values(CARD_TEMPLATES).forEach(cards => {
    cards.forEach(c => deck.push({ ...c }));
  });
  return shuffle(deck);
}

function dealCards(deck, count) {
  return deck.splice(0, count);
}

function createRoom(hostId, hostName) {
  const code = generateRoomCode();
  rooms[code] = {
    code,
    hostId,
    players: {},
    deck: buildDeck(),
    phase: 'lobby',
    round: 0,
    maxRounds: 5,
    pendingThrows: {},
    bombTimers: {},
    curseQueue: {},
    dares: {},
    allianceMap: {},
    log: []
  };
  addPlayer(code, hostId, hostName, true);
  return code;
}

function addPlayer(code, socketId, name, isHost = false) {
  const room = rooms[code];
  if (!room) return false;
  if (Object.keys(room.players).length >= 5) return false;
  room.players[socketId] = {
    id: socketId,
    name,
    isHost,
    hand: [],
    points: 0,
    shieldActive: false,
    mirrorShield: false,
    bombImmune: false,
    curseProtected: false,
    throwsLeft: 2,
    dareSubmitted: false,
  };
  return true;
}

function getPublicState(room, forPlayerId) {
  const players = {};
  Object.values(room.players).forEach(p => {
    players[p.id] = {
      id: p.id,
      name: p.name,
      isHost: p.isHost,
      points: p.points,
      cardCount: p.hand.length,
      shieldActive: p.shieldActive,
      throwsLeft: p.throwsLeft,
    };
  });
  return {
    code: room.code,
    phase: room.phase,
    round: room.round,
    maxRounds: room.maxRounds,
    players,
    myHand: room.players[forPlayerId]?.hand || [],
    log: room.log.slice(-8),
    allyId: room.allianceMap[forPlayerId] || null,
  };
}

function addLog(room, msg) {
  room.log.push({ time: Date.now(), msg });
  if (room.log.length > 30) room.log.shift();
}

function broadcastState(room) {
  Object.keys(room.players).forEach(pid => {
    const sock = io.sockets.sockets.get(pid);
    if (sock) sock.emit('state', getPublicState(room, pid));
  });
}

function startGame(room) {
  room.deck = buildDeck();
  room.round = 0;
  room.phase = 'playing';

  Object.values(room.players).forEach(p => {
    p.points = 0;
    p.hand = dealCards(room.deck, 5);
    p.throwsLeft = 2;
    p.shieldActive = false;
    p.mirrorShield = false;
  });

  const playerIds = Object.keys(room.players);
  if (playerIds.length >= 2) {
    const shuffled = shuffle(playerIds);
    room.allianceMap[shuffled[0]] = shuffled[1];
    room.allianceMap[shuffled[1]] = shuffled[0];
  }

  room.round = 1;
  addLog(room, 'Game dimulai! Ronde 1 dari 5.');
  broadcastState(room);
  io.to(room.code).emit('phase_change', { phase: 'throw', round: room.round, duration: 60 });
}

function resolveThrows(room) {
  const throws = room.pendingThrows;
  room.pendingThrows = {};

  Object.entries(throws).forEach(([fromId, throwData]) => {
    const { toId, cardIndex } = throwData;
    const sender = room.players[fromId];
    const target = room.players[toId];
    if (!sender || !target) return;

    const card = sender.hand[cardIndex];
    if (!card) return;

    sender.hand.splice(cardIndex, 1);

    if (card.type === 'shield') {
      sender.hand = [...sender.hand];
      if (card.id === 's2') sender.bombImmune = true;
      sender.shieldActive = true;
      if (card.id === 's3') sender.mirrorShield = true;
      sender.points += 1;
      addLog(room, `${sender.name} mengaktifkan ${card.title}.`);
      return;
    }

    if (target.shieldActive && card.type !== 'shield') {
      target.shieldActive = false;
      addLog(room, `${target.name} memblokir kartu dari ${sender.name}! Kartu balik.`);
      if (target.mirrorShield && card.type === 'question') {
        sender.hand.push(card);
        addLog(room, `Cermin aktif! Pertanyaan balik ke ${sender.name}.`);
      } else {
        sender.hand.push(card);
      }
      target.points += 3;
      sender.points -= 1;
      return;
    }

    if (card.type === 'question') {
      target.hand.push(card);
      addLog(room, `${sender.name} mengirim Pertanyaan ke ${target.name}.`);
    } else if (card.type === 'expose') {
      target.points -= 1;
      sender.points += 2;
      const exposeCard = target.hand.length > 0 ? target.hand[Math.floor(Math.random() * target.hand.length)] : null;
      if (exposeCard) {
        io.to(room.code).emit('expose_event', { from: sender.name, target: target.name, card: exposeCard });
        addLog(room, `${sender.name} memakai Expose pada ${target.name}!`);
      }
    } else if (card.type === 'bomb') {
      target.hand.push({ ...card, fromId, explodeAt: Date.now() + (card.id === 'b2' ? 20000 : card.id === 'b1' ? 25000 : 30000) });
      addLog(room, `${sender.name} melempar Bom ke ${target.name}! Tiktak...`);
      io.to(room.code).emit('bomb_alert', { target: toId, targetName: target.name, duration: card.id === 'b2' ? 20 : card.id === 'b1' ? 25 : 30, card });
      startBombTimer(room, toId, card);
    } else if (card.type === 'curse') {
      addLog(room, `${sender.name} mengirim Kutukan ke ${target.name}... efek akan terungkap.`);
      room.curseQueue[toId] = room.curseQueue[toId] || [];
      room.curseQueue[toId].push(card);
      io.to(toId).emit('curse_received', { from: sender.name });
    }
  });
}

function startBombTimer(room, playerId, card) {
  const duration = card.id === 'b2' ? 20000 : card.id === 'b1' ? 25000 : 30000;
  const timer = setTimeout(() => {
    const player = room.players[playerId];
    if (!player) return;
    const bombIdx = player.hand.findIndex(c => c.type === 'bomb');
    if (bombIdx === -1) return;
    const bomb = player.hand[bombIdx];
    player.hand.splice(bombIdx, 1);
    player.points -= 5;
    if (card.id === 'b3' && bomb.fromId && room.players[bomb.fromId]) {
      room.players[bomb.fromId].points -= 2;
      addLog(room, `Bom Berantai! ${player.name} −5 poin, ${room.players[bomb.fromId].name} −2 poin.`);
    } else {
      addLog(room, `BOOM! Bom meledak di tangan ${player.name}! −5 poin.`);
    }
    io.to(playerId).emit('bomb_explode', { card });
    broadcastState(room);
  }, duration);
  room.bombTimers[playerId] = timer;
}

function revealCurses(room) {
  Object.entries(room.curseQueue).forEach(([playerId, curses]) => {
    const player = room.players[playerId];
    if (!player) return;
    curses.forEach(card => {
      player.points += card.effect;
      io.to(playerId).emit('curse_reveal', { card, effect: card.effect });
      io.to(room.code).emit('curse_public', { playerName: player.name, reveal: card.reveal, effect: card.effect });
      addLog(room, `Kutukan ${player.name} terungkap: ${card.reveal}`);
    });
  });
  room.curseQueue = {};
}

function nextRound(room) {
  revealCurses(room);
  Object.values(room.players).forEach(p => {
    p.throwsLeft = 2;
    p.shieldActive = false;
    p.mirrorShield = false;
    p.bombImmune = false;
    if (p.hand.length < 3 && room.deck.length > 0) {
      const needed = 3 - p.hand.length;
      p.hand.push(...dealCards(room.deck, needed));
    }
  });

  if (room.round >= room.maxRounds) {
    endGame(room);
    return;
  }

  const scores = Object.values(room.players).map(p => p.points);
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  if (max - min <= 3 && room.round === room.maxRounds - 1) {
    room.maxRounds += 1;
    addLog(room, 'Skor terlalu dekat! Overtime ronde tambahan!');
    io.to(room.code).emit('overtime_alert');
  }

  room.round++;
  addLog(room, `Ronde ${room.round} dimulai.`);
  broadcastState(room);
  io.to(room.code).emit('phase_change', { phase: 'throw', round: room.round, duration: 60 });
}

function endGame(room) {
  room.phase = 'dare';
  const ranking = Object.values(room.players).sort((a, b) => a.points - b.points);
  const loser = ranking[0];
  addLog(room, `Game selesai! ${loser.name} harus menanggung dare!`);
  io.to(room.code).emit('game_over', {
    ranking: ranking.map(p => ({ id: p.id, name: p.name, points: p.points })),
    loserId: loser.id,
    loserName: loser.name,
  });
  broadcastState(room);
}

io.on('connection', (socket) => {
  socket.on('create_room', ({ name }) => {
    const code = createRoom(socket.id, name);
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.name = name;
    socket.emit('room_created', { code });
    broadcastState(rooms[code]);
  });

  socket.on('join_room', ({ code, name }) => {
    const room = rooms[code];
    if (!room) return socket.emit('error', { msg: 'Room tidak ditemukan.' });
    if (room.phase !== 'lobby') return socket.emit('error', { msg: 'Game sudah berjalan.' });
    if (Object.keys(room.players).length >= 5) return socket.emit('error', { msg: 'Room penuh (maks 5 pemain).' });
    const ok = addPlayer(code, socket.id, name);
    if (!ok) return socket.emit('error', { msg: 'Gagal join.' });
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.name = name;
    socket.emit('room_joined', { code });
    addLog(room, `${name} bergabung.`);
    broadcastState(room);
  });

  socket.on('start_game', () => {
    const room = rooms[socket.data.roomCode];
    if (!room) return;
    if (room.players[socket.id]?.isHost && Object.keys(room.players).length >= 2) {
      startGame(room);
    }
  });

  socket.on('throw_card', ({ toId, cardIndex }) => {
    const room = rooms[socket.data.roomCode];
    if (!room || room.phase !== 'playing') return;
    const player = room.players[socket.id];
    if (!player || player.throwsLeft <= 0) return;
    const existing = room.pendingThrows[socket.id];
    if (existing && existing.toId === toId) return;
    room.pendingThrows[socket.id] = { toId, cardIndex };
    player.throwsLeft--;
    broadcastState(room);
  });

  socket.on('pass_bomb', ({ toId }) => {
    const room = rooms[socket.data.roomCode];
    if (!room) return;
    const player = room.players[socket.id];
    const target = room.players[toId];
    if (!player || !target) return;
    const bombIdx = player.hand.findIndex(c => c.type === 'bomb');
    if (bombIdx === -1) return;
    const bomb = player.hand.splice(bombIdx, 1)[0];
    if (!bomb.passed) {
      bomb.passed = true;
      target.hand.push(bomb);
      player.points += 4;
      clearTimeout(room.bombTimers[socket.id]);
      delete room.bombTimers[socket.id];
      startBombTimer(room, toId, bomb);
      addLog(room, `${player.name} mengoper bom ke ${target.name}! +4 poin.`);
      io.to(room.code).emit('bomb_passed', { from: player.name, to: target.name });
      broadcastState(room);
    }
  });

  socket.on('answer_question', ({ cardId, answer }) => {
    const room = rooms[socket.data.roomCode];
    if (!room) return;
    const player = room.players[socket.id];
    if (!player) return;
    const idx = player.hand.findIndex(c => c.id === cardId && c.type === 'question');
    if (idx === -1) return;
    player.hand.splice(idx, 1);
    player.points += 2;
    addLog(room, `${player.name} menjawab pertanyaan.`);
    io.to(room.code).emit('answer_revealed', { playerName: player.name, answer, cardId });
    broadcastState(room);
  });

  socket.on('skip_question', ({ cardId }) => {
    const room = rooms[socket.data.roomCode];
    if (!room) return;
    const player = room.players[socket.id];
    if (!player) return;
    const idx = player.hand.findIndex(c => c.id === cardId && c.type === 'question');
    if (idx === -1) return;
    player.hand.splice(idx, 1);
    player.points -= 3;
    addLog(room, `${player.name} menolak menjawab pertanyaan. −3 poin.`);
    broadcastState(room);
  });

  socket.on('resolve_round', () => {
    const room = rooms[socket.data.roomCode];
    if (!room || !room.players[socket.id]?.isHost) return;
    resolveThrows(room);
    setTimeout(() => {
      broadcastState(room);
      io.to(room.code).emit('phase_change', { phase: 'reveal', round: room.round, duration: 15 });
      setTimeout(() => nextRound(room), 15000);
    }, 500);
  });

  socket.on('submit_dare', ({ dare }) => {
    const room = rooms[socket.data.roomCode];
    if (!room || room.phase !== 'dare') return;
    room.dares[socket.id] = { dare, name: room.players[socket.id]?.name };
    const allSubmitted = Object.keys(room.players).filter(id => {
      const loser = Object.values(room.players).sort((a, b) => a.points - b.points)[0];
      return id !== loser.id;
    }).every(id => room.dares[id]);

    if (allSubmitted) {
      const dareList = Object.values(room.dares);
      const chosen = dareList[Math.floor(Math.random() * dareList.length)];
      io.to(room.code).emit('dare_selected', { dare: chosen.dare, allDares: dareList.map(d => d.dare) });
    }
  });

  socket.on('disconnect', () => {
    const code = socket.data.roomCode;
    const room = rooms[code];
    if (!room) return;
    const player = room.players[socket.id];
    if (player) {
      addLog(room, `${player.name} keluar.`);
      delete room.players[socket.id];
      if (Object.keys(room.players).length === 0) {
        delete rooms[code];
      } else {
        if (player.isHost) {
          const newHost = Object.values(room.players)[0];
          if (newHost) newHost.isHost = true;
        }
        broadcastState(room);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Veil server running on port ${PORT}`));
