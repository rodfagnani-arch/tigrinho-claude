// ===================== GAME STATE =====================
const GRID_SIZE = 25;
const TOTAL_CELLS = 25;

let state = {
  balance: 1000,
  bet: 10,
  mines: 3,
  minePositions: [],
  revealedCells: [],
  gameActive: false,
  safeCellsRevealed: 0,
  history: []
};

// ===================== ICONS =====================
const SAFE_ICONS = ['🪖', '🔫', '🎖️', '⭐', '🛡️'];
const MINE_ICON = '💣';
const EXPLOSION_ICON = '💥';

// ===================== MULTIPLIER CALC =====================
function calcMultiplier(safeCellsRevealed, totalMines) {
  if (safeCellsRevealed === 0) return 1.0;
  const safeCells = TOTAL_CELLS - totalMines;
  let mult = 1.0;
  for (let i = 0; i < safeCellsRevealed; i++) {
    const remaining = TOTAL_CELLS - i;
    const safeRemaining = safeCells - i;
    mult *= remaining / safeRemaining;
  }
  // house edge
  mult *= 0.97;
  return parseFloat(mult.toFixed(2));
}

// ===================== INIT GRID =====================
function initGrid() {
  const grid = document.getElementById('minesGrid');
  grid.innerHTML = '';
  for (let i = 0; i < GRID_SIZE; i++) {
    const cell = document.createElement('div');
    cell.className = 'cell';
    cell.dataset.index = i;
    const icon = document.createElement('span');
    icon.className = 'cell-icon';
    cell.appendChild(icon);
    cell.addEventListener('click', () => revealCell(i));
    grid.appendChild(cell);
  }
}

// ===================== START GAME =====================
function startGame() {
  const bet = parseFloat(document.getElementById('betInput').value);
  if (isNaN(bet) || bet <= 0) { alert('Aposta inválida!'); return; }
  if (bet > state.balance) { alert('Saldo insuficiente!'); return; }

  state.bet = bet;
  state.balance -= bet;
  state.gameActive = true;
  state.safeCellsRevealed = 0;
  state.revealedCells = [];
  state.minePositions = generateMines(state.mines);

  updateBalance();
  updateUI();
  initGrid();
  updateMultiplierDisplay();
  updateProgress();

  document.getElementById('btnStart').disabled = true;
  document.getElementById('btnCashout').disabled = false;
  document.getElementById('betInput').disabled = true;
  document.querySelectorAll('.mine-opt').forEach(el => el.style.pointerEvents = 'none');
  document.querySelectorAll('.quick-bet').forEach(el => el.disabled = true);

  setMissionStatus('active', '● MISSÃO ATIVA');
}

// ===================== GENERATE MINES =====================
function generateMines(count) {
  const positions = new Set();
  while (positions.size < count) {
    positions.add(Math.floor(Math.random() * GRID_SIZE));
  }
  return [...positions];
}

// ===================== REVEAL CELL =====================
function revealCell(index) {
  if (!state.gameActive) return;
  if (state.revealedCells.includes(index)) return;

  state.revealedCells.push(index);
  const cell = document.querySelector(`.cell[data-index="${index}"]`);
  const icon = cell.querySelector('.cell-icon');

  if (state.minePositions.includes(index)) {
    // MINE HIT
    icon.textContent = EXPLOSION_ICON;
    cell.classList.add('mine', 'revealed');

    setTimeout(() => {
      revealAllMines();
      endGame(false);
    }, 350);
  } else {
    // SAFE
    state.safeCellsRevealed++;
    const safeIcons = SAFE_ICONS;
    icon.textContent = safeIcons[state.safeCellsRevealed % safeIcons.length];
    cell.classList.add('safe', 'revealed', 'win-anim');

    updateMultiplierDisplay();
    updateProgress();
    updateUI();

    // Check full clear
    const totalSafe = GRID_SIZE - state.mines;
    if (state.safeCellsRevealed >= totalSafe) {
      setTimeout(() => cashout(), 200);
    }
  }
}

// ===================== REVEAL ALL MINES =====================
function revealAllMines() {
  state.minePositions.forEach(pos => {
    const cell = document.querySelector(`.cell[data-index="${pos}"]`);
    if (!cell.classList.contains('revealed')) {
      const icon = cell.querySelector('.cell-icon');
      icon.textContent = MINE_ICON;
      cell.classList.add('mine', 'revealed');
    }
  });
  // Dim unrevealed safe cells
  document.querySelectorAll('.cell:not(.revealed)').forEach(c => c.classList.add('disabled'));
}

// ===================== CASHOUT =====================
function cashout() {
  if (!state.gameActive) return;
  const mult = calcMultiplier(state.safeCellsRevealed, state.mines);
  const winAmount = parseFloat((state.bet * mult).toFixed(2));
  state.balance += winAmount;
  endGame(true, winAmount, mult);
}

// ===================== END GAME =====================
function endGame(won, amount = 0, mult = 1) {
  state.gameActive = false;

  // History
  state.history.unshift(won ? 'w' : 'l');
  if (state.history.length > 20) state.history.pop();
  renderHistory();

  document.getElementById('btnStart').disabled = false;
  document.getElementById('btnCashout').disabled = true;
  document.getElementById('betInput').disabled = false;
  document.querySelectorAll('.mine-opt').forEach(el => el.style.pointerEvents = '');
  document.querySelectorAll('.quick-bet').forEach(el => el.disabled = false);

  updateBalance();
  updateProgress();
  setMissionStatus(won ? 'success' : 'danger', won ? '● EXTRAÇÃO OK' : '● MISSÃO FALHOU');

  // Disable all cells
  document.querySelectorAll('.cell').forEach(c => c.classList.add('disabled'));

  setTimeout(() => {
    if (won) {
      showMessage(true, amount, mult);
    } else {
      showMessage(false, state.bet, 0);
    }
    setMissionStatus('standby', '● AGUARDANDO');
  }, won ? 300 : 700);
}

// ===================== SHOW MESSAGE =====================
function showMessage(won, amount, mult) {
  const overlay = document.getElementById('msgOverlay');
  const box = document.getElementById('msgBox');
  const title = document.getElementById('msgTitle');
  const sub = document.getElementById('msgSub');
  const amountEl = document.getElementById('msgAmount');

  box.className = 'message-box ' + (won ? 'win-box' : 'loss-box');
  title.className = 'msg-title ' + (won ? 'win' : 'loss');
  amountEl.className = 'msg-amount ' + (won ? 'win' : 'loss');

  if (won) {
    title.textContent = '🎖️ VITÓRIA!';
    sub.textContent = `MISSÃO CONCLUÍDA · ${mult}x MULTIPLICADOR`;
    amountEl.textContent = `+${formatBRL(amount)}`;
  } else {
    title.textContent = '💥 BAIXA!';
    sub.textContent = 'SOLDADO ELIMINADO · MISSÃO FALHOU';
    amountEl.textContent = `-${formatBRL(state.bet)}`;
  }

  overlay.classList.add('show');
}

function closeMessage() {
  document.getElementById('msgOverlay').classList.remove('show');
  resetMultiplierDisplay();
  updateProgress();
}

// ===================== UPDATE MULTIPLIER =====================
function updateMultiplierDisplay() {
  const mult = calcMultiplier(state.safeCellsRevealed, state.mines);
  const el = document.getElementById('multiplierDisplay');
  el.textContent = mult.toFixed(2) + 'x';
  el.className = 'mult-value';
  if (mult >= 5) el.classList.add('extreme');
  else if (mult >= 2) el.classList.add('high');

  const bet = parseFloat(document.getElementById('betInput').value) || 0;
  const potential = (bet * mult).toFixed(2);
  document.getElementById('potentialWin').textContent = formatBRL(potential);
}

function resetMultiplierDisplay() {
  document.getElementById('multiplierDisplay').textContent = '1.00x';
  document.getElementById('multiplierDisplay').className = 'mult-value';
  document.getElementById('potentialWin').textContent = 'R$ 0,00';
}

// ===================== PROGRESS =====================
function updateProgress() {
  const totalSafe = GRID_SIZE - state.mines;
  const pct = state.gameActive ? Math.round((state.safeCellsRevealed / totalSafe) * 100) : 0;
  document.getElementById('progressFill').style.width = pct + '%';
  document.getElementById('progressPct').textContent = pct + '%';
  document.getElementById('safeCount').textContent = `${state.safeCellsRevealed} / ${totalSafe}`;
}

// ===================== HISTORY =====================
function renderHistory() {
  const container = document.getElementById('historyDots');
  container.innerHTML = '';
  state.history.forEach(h => {
    const dot = document.createElement('div');
    dot.className = 'hist-dot ' + h;
    container.appendChild(dot);
  });
}

// ===================== BALANCE =====================
function updateBalance() {
  document.getElementById('balance').textContent = formatBRL(state.balance);
}

// ===================== MISSION STATUS =====================
function setMissionStatus(cls, text) {
  const el = document.getElementById('missionStatus');
  el.className = 'mission-status ' + cls;
  el.textContent = text;
}

// ===================== UI UPDATE =====================
function updateUI() {
  updateMultiplierDisplay();
}

// ===================== BET HELPERS =====================
function setBet(val) {
  if (!state.gameActive) {
    document.getElementById('betInput').value = val;
    updateMultiplierDisplay();
  }
}

function doubleBet() {
  if (!state.gameActive) {
    const cur = parseFloat(document.getElementById('betInput').value) || 0;
    document.getElementById('betInput').value = Math.min(cur * 2, state.balance);
    updateMultiplierDisplay();
  }
}

// ===================== MINES SELECTOR =====================
document.querySelectorAll('.mine-opt').forEach(el => {
  el.addEventListener('click', () => {
    if (state.gameActive) return;
    document.querySelectorAll('.mine-opt').forEach(e => e.classList.remove('active'));
    el.classList.add('active');
    state.mines = parseInt(el.dataset.val);
    updateMultiplierDisplay();
  });
});

// Bet input live update
document.getElementById('betInput').addEventListener('input', () => {
  if (!state.gameActive) updateMultiplierDisplay();
});

// ===================== FORMAT =====================
function formatBRL(val) {
  return 'R$ ' + parseFloat(val).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ===================== INIT =====================
initGrid();
updateBalance();
renderHistory();