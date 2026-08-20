// ===================== CONFIGURAÇÃO =====================
const GRID_SIZE = 25;
const TOTAL_CELLS = 25;
const BET_MIN = 1;
const BET_MAX = 1000;
const ACTIVE_STATUSES = new Set(["active", "started", "in_progress"]);
const LOSS_STATUSES = new Set(["lost", "exploded", "failed"]);
const WIN_STATUSES = new Set(["won", "completed", "cashed_out", "cashout"]);
const CANCELLED_STATUSES = new Set(["cancelled", "canceled"]);
const ALLOWED_MINE_COUNTS = new Set([1, 3, 5, 10, 15]);

const SAFE_ICONS = ["🪖", "🔫", "🎖️", "⭐", "🛡️"];
const MINE_ICON = "💣";
const EXPLOSION_ICON = "💥";

let CasinoWallet = null;
let unsubscribeBalance = null;
let messageTimer = null;
let missionTimer = null;

const state = {
  balance: 0,
  bet: 10,
  mines: 3,
  roundId: null,
  minePositions: [],
  revealedCells: new Set(),
  gameActive: false,
  pendingAction: null,
  safeCellsRevealed: 0,
  totalSafe: 22,
  multiplier: 1,
  potentialPayout: 0,
  walletVersion: null,
  history: []
};

// A lógica oficial do jogo pertence à carteira/API carregada na página principal.
// Este iframe apenas envia ações e desenha os resultados retornados pelo servidor.
function getParentWallet() {
  let wallet;

  try {
    wallet = window.parent.CasinoWallet;
  } catch (error) {
    throw new Error("Não foi possível acessar a carteira da página principal.", { cause: error });
  }

  const requiredMethods = [
    "getBalance",
    "minesStart",
    "minesState",
    "minesReveal",
    "minesCashout",
    "subscribe"
  ];

  if (!wallet || requiredMethods.some(method => typeof wallet[method] !== "function")) {
    throw new Error("A carteira do cassino ainda não está disponível.");
  }

  return wallet;
}

async function waitForParentWallet(timeoutMs = 5000) {
  const startedAt = Date.now();
  let lastError;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      return getParentWallet();
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  throw lastError || new Error("A carteira do cassino não foi carregada.");
}

// ===================== UTILITÁRIOS DE RESPOSTA =====================
function toFiniteNumber(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function getResponseBalance(payload) {
  const rawBalance = payload && typeof payload === "object" && "balance" in payload
    ? payload.balance
    : payload;
  const balance = toFiniteNumber(rawBalance);
  return balance !== null && balance >= 0 ? balance : null;
}

function applyBalance(payload) {
  const balance = getResponseBalance(payload);
  if (balance === null) return false;

  state.balance = balance;
  renderBalance();
  return true;
}

function normalizeStatus(status) {
  return String(status || "").trim().toLowerCase();
}

function sanitizePositions(positions) {
  if (!Array.isArray(positions)) return [];

  return [...new Set(positions
    .map(Number)
    .filter(position => Number.isInteger(position) && position >= 0 && position < GRID_SIZE))];
}

function assertResult(result, operation) {
  if (!result || typeof result !== "object") {
    throw new Error(`Resposta inválida ao ${operation}.`);
  }
  return result;
}

function applyWalletVersion(result) {
  if (result?.walletVersion !== null && result?.walletVersion !== undefined) {
    state.walletVersion = result.walletVersion;
  }
}

function friendlyError(error, fallback) {
  const rawMessage = String(error?.message || "").trim();
  const normalized = rawMessage.toLowerCase();

  if (normalized.includes("insufficient") || normalized.includes("saldo insuficiente")) {
    return "Saldo insuficiente para essa aposta.";
  }
  if (normalized.includes("unauthorized") || normalized.includes("jwt") || normalized.includes("sessão")) {
    return "Sua sessão expirou. Entre novamente para continuar.";
  }
  if (error?.status === 429 || normalized.includes("limite") || normalized.includes("muitas jogadas")) {
    return "Muitas jogadas em pouco tempo. Aguarde alguns segundos.";
  }
  if (normalized.includes("round") && normalized.includes("active")) {
    return "Já existe uma rodada ativa para este usuário.";
  }
  if (normalized.includes("network") || normalized.includes("fetch")) {
    return "Não foi possível conectar ao servidor. Verifique sua internet.";
  }

  return rawMessage || fallback;
}

function reportError(error, fallback) {
  console.error(error);
  alert(friendlyError(error, fallback));
}

// ===================== GRADE =====================
function initGrid() {
  const grid = document.getElementById("minesGrid");
  grid.innerHTML = "";

  for (let index = 0; index < GRID_SIZE; index++) {
    const cell = document.createElement("div");
    cell.className = "cell";
    cell.dataset.index = String(index);
    cell.setAttribute("role", "button");
    cell.setAttribute("aria-label", `Campo ${index + 1}`);
    cell.setAttribute("tabindex", "0");

    const icon = document.createElement("span");
    icon.className = "cell-icon";
    cell.appendChild(icon);

    cell.addEventListener("click", () => revealCell(index));
    cell.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        revealCell(index);
      }
    });

    grid.appendChild(cell);
  }

  syncControls();
}

function getCell(index) {
  return document.querySelector(`.cell[data-index="${index}"]`);
}

function renderSafeCell(index) {
  const cell = getCell(index);
  if (!cell) return;

  const icon = cell.querySelector(".cell-icon");
  icon.textContent = SAFE_ICONS[Math.max(0, state.safeCellsRevealed - 1) % SAFE_ICONS.length];
  cell.classList.remove("disabled", "mine");
  cell.classList.add("safe", "revealed", "win-anim");
  cell.setAttribute("aria-label", `Campo ${index + 1}: seguro`);
  cell.setAttribute("aria-disabled", "true");
}

function renderMineCell(index, exploded = false) {
  const cell = getCell(index);
  if (!cell) return;

  const icon = cell.querySelector(".cell-icon");
  icon.textContent = exploded ? EXPLOSION_ICON : MINE_ICON;
  cell.classList.remove("disabled", "safe");
  cell.classList.add("mine", "revealed");
  cell.setAttribute("aria-label", `Campo ${index + 1}: mina`);
  cell.setAttribute("aria-disabled", "true");
}

function revealAllMines(positions = state.minePositions) {
  sanitizePositions(positions).forEach(position => {
    if (!state.revealedCells.has(position)) renderMineCell(position);
  });

  document.querySelectorAll(".cell:not(.revealed)").forEach(cell => {
    cell.classList.add("disabled");
    cell.setAttribute("aria-disabled", "true");
  });
}

// ===================== CONTROLES =====================
function setPendingAction(action) {
  state.pendingAction = action;
  syncControls();
}

function syncControls() {
  const walletUnavailable = !CasinoWallet;
  const configurationLocked = walletUnavailable || state.gameActive || Boolean(state.pendingAction);
  const btnStart = document.getElementById("btnStart");
  const btnCashout = document.getElementById("btnCashout");

  btnStart.disabled = configurationLocked;
  btnStart.textContent = state.pendingAction === "start"
    ? "⌛ INICIANDO..."
    : "⚔ INICIAR MISSÃO";

  btnCashout.disabled = walletUnavailable
    || !state.gameActive
    || Boolean(state.pendingAction)
    || state.safeCellsRevealed < 1;
  btnCashout.textContent = state.pendingAction === "cashout"
    ? "⌛ EXTRAINDO..."
    : "💰 EXTRAIR TROPAS";

  document.getElementById("betInput").disabled = configurationLocked;
  document.querySelectorAll(".quick-bet").forEach(button => {
    button.disabled = configurationLocked;
  });
  document.querySelectorAll(".mine-opt").forEach(option => {
    option.style.pointerEvents = configurationLocked ? "none" : "";
    option.setAttribute("aria-disabled", String(configurationLocked));
  });

  document.querySelectorAll(".cell").forEach(cell => {
    const index = Number(cell.dataset.index);
    const alreadyRevealed = state.revealedCells.has(index);
    const blocked = !state.gameActive || Boolean(state.pendingAction) || alreadyRevealed;

    cell.classList.toggle("disabled", blocked && !cell.classList.contains("revealed"));
    cell.setAttribute("aria-disabled", String(blocked));
    cell.tabIndex = blocked ? -1 : 0;
  });
}

function selectMineCount(mineCount) {
  document.querySelectorAll(".mine-opt").forEach(option => {
    option.classList.toggle("active", Number(option.dataset.val) === mineCount);
  });
}

function normalizeRoundSnapshot(result) {
  assertResult(result, "sincronizar a rodada");
  const status = normalizeStatus(result.status);

  if (status === "none" && !result.roundId) return { status, roundId: null };

  const roundId = typeof result.roundId === "string" ? result.roundId : "";
  const bet = toFiniteNumber(result.bet);
  const mineCount = Number(result.mineCount);
  const totalSafe = Number(result.totalSafe);
  const safeRevealed = Number(result.safeRevealed);
  const multiplier = toFiniteNumber(result.multiplier);
  const potentialPayout = toFiniteNumber(result.potentialPayout);
  const revealedSafeIndexes = sanitizePositions(result.revealedSafeIndexes);

  if (
    !roundId
    || !Number.isFinite(bet)
    || bet <= 0
    || !ALLOWED_MINE_COUNTS.has(mineCount)
    || totalSafe !== TOTAL_CELLS - mineCount
    || !Number.isInteger(safeRevealed)
    || safeRevealed < 0
    || safeRevealed > totalSafe
    || revealedSafeIndexes.length !== safeRevealed
    || multiplier === null
    || multiplier < 0
    || potentialPayout === null
    || potentialPayout < 0
  ) {
    throw new Error("O servidor retornou um estado inválido para a rodada do Mines.");
  }

  return {
    status,
    roundId,
    bet,
    mineCount,
    totalSafe,
    safeRevealed,
    multiplier,
    potentialPayout,
    revealedSafeIndexes,
    minePositions: sanitizePositions(result.minePositions)
  };
}

function prepareRoundSnapshot(snapshot, result) {
  clearTimeout(messageTimer);
  clearTimeout(missionTimer);
  document.getElementById("msgOverlay").classList.remove("show");

  state.bet = snapshot.bet;
  state.mines = snapshot.mineCount;
  state.roundId = snapshot.roundId;
  state.safeCellsRevealed = snapshot.safeRevealed;
  state.totalSafe = snapshot.totalSafe;
  state.revealedCells = new Set(snapshot.revealedSafeIndexes);
  state.minePositions = snapshot.minePositions;
  state.multiplier = snapshot.multiplier;
  state.potentialPayout = snapshot.potentialPayout;
  applyWalletVersion(result);

  document.getElementById("betInput").value = snapshot.bet;
  selectMineCount(snapshot.mineCount);
  applyBalance(result);
  initGrid();
  snapshot.revealedSafeIndexes.forEach(renderSafeCell);
}

function restoreRoundSnapshot(result) {
  const snapshot = normalizeRoundSnapshot(result);

  if (snapshot.status === "none") {
    if (state.gameActive) {
      state.gameActive = false;
      state.roundId = null;
      state.revealedCells = new Set();
      state.minePositions = [];
      state.safeCellsRevealed = 0;
      state.totalSafe = TOTAL_CELLS - state.mines;
      state.multiplier = 1;
      state.potentialPayout = 0;
      initGrid();
      updateRoundDisplays();
    }
    applyBalance(result);
    setMissionStatus("standby", "● AGUARDANDO");
    return "none";
  }

  const isActive = ACTIVE_STATUSES.has(snapshot.status);
  const isWon = WIN_STATUSES.has(snapshot.status);
  const isLost = LOSS_STATUSES.has(snapshot.status);
  const isCancelled = CANCELLED_STATUSES.has(snapshot.status);

  if (!isActive && !isWon && !isLost && !isCancelled) {
    throw new Error("O servidor retornou um status desconhecido para a rodada do Mines.");
  }

  if (!isActive && snapshot.minePositions.length !== snapshot.mineCount) {
    throw new Error("O servidor não retornou as minas da rodada encerrada.");
  }

  state.gameActive = isActive;
  prepareRoundSnapshot(snapshot, result);
  updateRoundDisplays();

  if (isActive) {
    setMissionStatus("active", "● MISSÃO RETOMADA");
    return "active";
  }

  revealAllMines(snapshot.minePositions);

  if (isCancelled) {
    state.gameActive = false;
    state.roundId = null;
    setMissionStatus("danger", "● MISSÃO CANCELADA");
    syncControls();
    return "cancelled";
  }

  finishRound(isWon, isWon ? snapshot.potentialPayout : 0, snapshot.multiplier);
  return isWon ? "won" : "lost";
}

async function reconcileRound({ quiet = false } = {}) {
  if (!CasinoWallet || state.pendingAction) return false;

  const roundId = state.gameActive ? state.roundId : null;
  setPendingAction("reconcile");

  try {
    const result = await CasinoWallet.minesState(roundId);
    restoreRoundSnapshot(result);
    return true;
  } catch (error) {
    if (quiet) {
      console.error("Falha ao sincronizar a rodada do Mines:", error);
    } else {
      reportError(error, "Não foi possível sincronizar a rodada do Mines.");
    }
    return false;
  } finally {
    setPendingAction(null);
  }
}

function isActiveRoundConflict(error) {
  const message = String(error?.message || "").toLowerCase();
  return message.includes("active_round_exists")
    || (message.includes("rodada") && message.includes("ativa"));
}

// ===================== INICIAR RODADA =====================
async function startGame() {
  if (!CasinoWallet || state.gameActive || state.pendingAction) return;

  const bet = Number(document.getElementById("betInput").value);
  if (!Number.isFinite(bet) || bet < BET_MIN || bet > BET_MAX) {
    alert(`A aposta precisa ficar entre R$ ${BET_MIN} e R$ ${BET_MAX}.`);
    return;
  }

  clearTimeout(messageTimer);
  clearTimeout(missionTimer);
  document.getElementById("msgOverlay").classList.remove("show");
  setPendingAction("start");
  setMissionStatus("active", "● PREPARANDO MISSÃO");
  let shouldReconcile = false;

  try {
    const result = assertResult(
      await CasinoWallet.minesStart(bet, state.mines),
      "iniciar a rodada"
    );

    if (result.roundId === null || result.roundId === undefined || result.roundId === "") {
      throw new Error("O servidor não retornou o identificador da rodada.");
    }

    const status = normalizeStatus(result.status);
    if (
      Array.isArray(result.revealedSafeIndexes)
      || WIN_STATUSES.has(status)
      || LOSS_STATUSES.has(status)
      || CANCELLED_STATUSES.has(status)
    ) {
      restoreRoundSnapshot(result);
      return;
    }

    if (!ACTIVE_STATUSES.has(status)) {
      throw new Error("O servidor não abriu uma rodada ativa.");
    }

    state.bet = bet;
    state.roundId = result.roundId;
    state.gameActive = true;
    state.safeCellsRevealed = 0;
    const reportedTotalSafe = Number(result.totalSafe);
    state.totalSafe = Number.isInteger(reportedTotalSafe)
      && reportedTotalSafe > 0
      && reportedTotalSafe <= TOTAL_CELLS
      ? reportedTotalSafe
      : TOTAL_CELLS - state.mines;
    state.revealedCells = new Set();
    state.minePositions = [];
    state.multiplier = 1;
    state.potentialPayout = 0;

    applyWalletVersion(result);
    applyBalance(result);
    initGrid();
    updateRoundDisplays();
    setMissionStatus("active", "● MISSÃO ATIVA");
  } catch (error) {
    setMissionStatus("standby", "● AGUARDANDO");
    if (isActiveRoundConflict(error)) {
      shouldReconcile = true;
    } else {
      reportError(error, "Não foi possível iniciar a missão.");
    }
  } finally {
    setPendingAction(null);
  }

  if (shouldReconcile) await reconcileRound();
}

// ===================== REVELAR CAMPO =====================
async function revealCell(index) {
  if (!CasinoWallet || !state.gameActive || state.pendingAction) return;
  if (!Number.isInteger(index) || index < 0 || index >= GRID_SIZE) return;
  if (state.revealedCells.has(index)) return;

  const activeRoundId = state.roundId;
  let shouldAutoCashout = false;
  setPendingAction("reveal");
  setMissionStatus("active", "● ANALISANDO SETOR");

  try {
    const result = assertResult(
      await CasinoWallet.minesReveal(activeRoundId, index),
      "revelar o campo"
    );

    // Descarta uma resposta atrasada caso a rodada tenha mudado.
    if (!state.gameActive || state.roundId !== activeRoundId) return;

    const responseIndex = Number(result.cellIndex);
    const revealedIndex = Number.isInteger(responseIndex)
      && responseIndex >= 0
      && responseIndex < GRID_SIZE
      ? responseIndex
      : index;

    const safeRevealed = toFiniteNumber(result.safeRevealed);
    const multiplier = toFiniteNumber(result.multiplier);
    const potentialPayout = toFiniteNumber(result.potentialPayout);
    const status = normalizeStatus(result.status);

    if (!ACTIVE_STATUSES.has(status)) {
      const finalState = await CasinoWallet.minesState(activeRoundId);
      restoreRoundSnapshot(finalState);
      return;
    }

    state.revealedCells.add(revealedIndex);
    if (safeRevealed !== null && safeRevealed >= 0) {
      state.safeCellsRevealed = Math.floor(safeRevealed);
    }
    if (multiplier !== null && multiplier >= 0) state.multiplier = multiplier;
    if (potentialPayout !== null && potentialPayout >= 0) {
      state.potentialPayout = potentialPayout;
    }
    if (Array.isArray(result.minePositions)) {
      state.minePositions = sanitizePositions(result.minePositions);
    }
    applyWalletVersion(result);
    applyBalance(result);

    if (result.hitMine === true || result.isMine === true) {
      renderMineCell(revealedIndex, true);
      revealAllMines();
      finishRound(false, 0, state.multiplier);
      return;
    }

    renderSafeCell(revealedIndex);
    updateRoundDisplays();

    setMissionStatus("active", "● MISSÃO ATIVA");
    shouldAutoCashout = ACTIVE_STATUSES.has(status)
      && state.safeCellsRevealed >= state.totalSafe;
  } catch (error) {
    setMissionStatus("active", "● MISSÃO ATIVA");
    reportError(error, "Não foi possível revelar esse campo.");
  } finally {
    setPendingAction(null);
  }

  if (shouldAutoCashout && state.gameActive) await cashout();
}

// ===================== ENCERRAR COM RESGATE =====================
async function cashout() {
  if (!CasinoWallet || !state.gameActive || state.pendingAction) return;
  if (state.safeCellsRevealed < 1) return;

  const activeRoundId = state.roundId;
  setPendingAction("cashout");
  setMissionStatus("active", "● EXTRAÇÃO EM CURSO");

  try {
    const result = assertResult(
      await CasinoWallet.minesCashout(activeRoundId),
      "resgatar o prêmio"
    );

    if (!state.gameActive || state.roundId !== activeRoundId) return;
    const status = normalizeStatus(result.status);
    if (!WIN_STATUSES.has(status)) {
      throw new Error("O servidor não confirmou a extração da rodada.");
    }

    const finalState = await CasinoWallet.minesState(activeRoundId);
    restoreRoundSnapshot(finalState);
  } catch (error) {
    setMissionStatus("active", "● MISSÃO ATIVA");
    reportError(error, "Não foi possível concluir a extração.");
  } finally {
    setPendingAction(null);
  }
}

// ===================== FINALIZAÇÃO LOCAL DA INTERFACE =====================
function finishRound(won, amount = 0, multiplier = 1) {
  state.gameActive = false;
  state.roundId = null;
  state.history.unshift(won ? "w" : "l");
  if (state.history.length > 20) state.history.pop();

  renderHistory();
  updateRoundDisplays();
  setMissionStatus(won ? "success" : "danger", won ? "● EXTRAÇÃO OK" : "● MISSÃO FALHOU");

  document.querySelectorAll(".cell").forEach(cell => {
    cell.classList.add("disabled");
    cell.setAttribute("aria-disabled", "true");
    cell.tabIndex = -1;
  });

  messageTimer = setTimeout(() => {
    showMessage(won, amount, multiplier);
    missionTimer = setTimeout(() => {
      setMissionStatus("standby", "● AGUARDANDO");
    }, 700);
  }, won ? 300 : 700);
}

// ===================== MENSAGEM =====================
function showMessage(won, amount, multiplier) {
  const overlay = document.getElementById("msgOverlay");
  const box = document.getElementById("msgBox");
  const title = document.getElementById("msgTitle");
  const sub = document.getElementById("msgSub");
  const amountEl = document.getElementById("msgAmount");

  box.className = `message-box ${won ? "win-box" : "loss-box"}`;
  title.className = `msg-title ${won ? "win" : "loss"}`;
  amountEl.className = `msg-amount ${won ? "win" : "loss"}`;

  if (won) {
    title.textContent = "🎖️ VITÓRIA!";
    sub.textContent = `MISSÃO CONCLUÍDA · ${formatMultiplier(multiplier)} MULTIPLICADOR`;
    amountEl.textContent = `+${formatBRL(amount)}`;
  } else {
    title.textContent = "💥 BAIXA!";
    sub.textContent = "SOLDADO ELIMINADO · MISSÃO FALHOU";
    amountEl.textContent = `-${formatBRL(state.bet)}`;
  }

  overlay.classList.add("show");
}

function closeMessage() {
  document.getElementById("msgOverlay").classList.remove("show");
  resetRoundDisplays();
}

// ===================== EXIBIÇÃO =====================
function formatMultiplier(multiplier) {
  const value = toFiniteNumber(multiplier, 1);
  return `${Math.max(0, value).toFixed(2)}x`;
}

function updateMultiplierDisplay() {
  const multiplier = Math.max(0, toFiniteNumber(state.multiplier, 1));
  const element = document.getElementById("multiplierDisplay");

  element.textContent = formatMultiplier(multiplier);
  element.className = "mult-value";
  if (multiplier >= 5) element.classList.add("extreme");
  else if (multiplier >= 2) element.classList.add("high");

  // O potencial é exibido somente quando vem da API; não é calculado no navegador.
  document.getElementById("potentialWin").textContent = formatBRL(state.potentialPayout);
}

function updateProgress() {
  const totalSafe = state.totalSafe;
  const revealed = Math.min(state.safeCellsRevealed, totalSafe);
  const percentage = state.gameActive || revealed > 0
    ? Math.round((revealed / totalSafe) * 100)
    : 0;

  document.getElementById("progressFill").style.width = `${percentage}%`;
  document.getElementById("progressPct").textContent = `${percentage}%`;
  document.getElementById("safeCount").textContent = `${revealed} / ${totalSafe}`;
}

function updateRoundDisplays() {
  updateMultiplierDisplay();
  updateProgress();
  syncControls();
}

function resetRoundDisplays() {
  if (state.gameActive) return;
  state.safeCellsRevealed = 0;
  state.multiplier = 1;
  state.potentialPayout = 0;
  updateRoundDisplays();
}

function renderHistory() {
  const container = document.getElementById("historyDots");
  container.innerHTML = "";

  state.history.forEach(result => {
    const dot = document.createElement("div");
    dot.className = `hist-dot ${result}`;
    container.appendChild(dot);
  });
}

function renderBalance() {
  document.getElementById("balance").textContent = formatBRL(state.balance);
}

async function refreshBalance() {
  if (!CasinoWallet) return;
  const result = await CasinoWallet.getBalance();
  if (!applyBalance(result)) throw new Error("A API retornou um saldo inválido.");
}

function setMissionStatus(statusClass, text) {
  const element = document.getElementById("missionStatus");
  element.className = `mission-status ${statusClass}`;
  element.textContent = text;
}

function setBet(value) {
  if (state.gameActive || state.pendingAction) return;
  document.getElementById("betInput").value = value;
  state.potentialPayout = 0;
  updateMultiplierDisplay();
}

function doubleBet() {
  if (state.gameActive || state.pendingAction) return;
  const input = document.getElementById("betInput");
  const current = toFiniteNumber(input.value, 0);
  input.value = Math.min(current * 2, state.balance, BET_MAX);
  state.potentialPayout = 0;
  updateMultiplierDisplay();
}

function formatBRL(value) {
  const amount = toFiniteNumber(value, 0);
  return amount.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

// ===================== EVENTOS =====================
document.querySelectorAll(".mine-opt").forEach(option => {
  option.addEventListener("click", () => {
    if (state.gameActive || state.pendingAction) return;

    document.querySelectorAll(".mine-opt").forEach(item => item.classList.remove("active"));
    option.classList.add("active");
    state.mines = Number(option.dataset.val);
    state.safeCellsRevealed = 0;
    state.totalSafe = TOTAL_CELLS - state.mines;
    state.multiplier = 1;
    state.potentialPayout = 0;
    updateRoundDisplays();
  });
});

document.getElementById("betInput").addEventListener("input", () => {
  if (!state.gameActive) {
    state.potentialPayout = 0;
    updateMultiplierDisplay();
  }
});

window.addEventListener("focus", () => {
  reconcileRound({ quiet: true }).catch(error => {
    console.error("Falha ao reconciliar a rodada do Mines:", error);
  });
});

window.addEventListener("beforeunload", () => {
  if (typeof unsubscribeBalance === "function") unsubscribeBalance();
});

// ===================== INICIALIZAÇÃO =====================
async function initializeGame() {
  initGrid();
  renderHistory();
  renderBalance();
  updateRoundDisplays();

  try {
    CasinoWallet = await waitForParentWallet();

    const subscription = await CasinoWallet.subscribe(payload => {
      applyBalance(payload);
    });
    if (typeof subscription === "function") unsubscribeBalance = subscription;

    await reconcileRound();
  } catch (error) {
    console.error(error);
    setMissionStatus("danger", "● CARTEIRA INDISPONÍVEL");
    document.getElementById("balance").textContent = "INDISPONÍVEL";
  } finally {
    syncControls();
  }
}

initializeGame();
