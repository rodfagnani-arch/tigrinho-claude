(function createSlotFrontend() {
  "use strict";

  const GRID_SIZE = 5;
  const SYMBOL_HEIGHT = 58;
  const BET_MIN = 10;
  const BET_MAX = 100;
  const BET_STEP = 10;
  const DISPLAY_SYMBOLS = ["🐟", "🐠", "🦈", "🐡", "🦞", "🐚", "💎", "🌿", "🪸", "🎣"];
  const INITIAL_GRID = Array.from({ length: GRID_SIZE }, (_, row) =>
    Array.from({ length: GRID_SIZE }, (_, column) =>
      DISPLAY_SYMBOLS[(row * 2 + column * 3) % DISPLAY_SYMBOLS.length]
    )
  );

  const elements = {
    balance: document.getElementById("balanceVal"),
    bet: document.getElementById("betVal"),
    betDown: document.getElementById("betDown"),
    betUp: document.getElementById("betUp"),
    lastWin: document.getElementById("lastWinVal"),
    reels: document.getElementById("reelsContainer"),
    result: document.getElementById("resultMsg"),
    spin: document.getElementById("spinBtn")
  };

  let wallet = null;
  let unsubscribeFromWallet = null;
  let balance = 0;
  let bet = BET_MIN;
  let spinning = false;
  let queuedBalance = null;

  function formatMoney(value) {
    return Number(value).toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  function normalizeMoney(value, fieldName) {
    const number = Number(value);

    if (!Number.isFinite(number) || number < 0) {
      throw new TypeError(`Resposta inválida: ${fieldName}.`);
    }

    return Math.round((number + Number.EPSILON) * 100) / 100;
  }

  function normalizeBalancePayload(payload) {
    const value = payload && typeof payload === "object" ? payload.balance : payload;
    return normalizeMoney(value, "saldo");
  }

  function normalizeGrid(grid) {
    const isValid = Array.isArray(grid)
      && grid.length === GRID_SIZE
      && grid.every(row =>
        Array.isArray(row)
        && row.length === GRID_SIZE
        && row.every(symbol => typeof symbol === "string" && symbol.length > 0)
      );

    if (!isValid) {
      throw new TypeError("Resposta inválida: a grade precisa ter 5 linhas e 5 colunas.");
    }

    return grid.map(row => [...row]);
  }

  function normalizeWins(wins) {
    if (!Array.isArray(wins)) {
      throw new TypeError("Resposta inválida: lista de ganhos ausente.");
    }

    return wins.map(win => {
      if (!win || !Array.isArray(win.cells)) {
        throw new TypeError("Resposta inválida: coordenadas do ganho ausentes.");
      }

      const cells = win.cells.map(cell => {
        const row = Number(cell?.row);
        const column = Number(cell?.column);
        const isValidCell = Number.isInteger(row)
          && Number.isInteger(column)
          && row >= 0
          && row < GRID_SIZE
          && column >= 0
          && column < GRID_SIZE;

        if (!isValidCell) {
          throw new TypeError("Resposta inválida: coordenada fora da grade.");
        }

        return { row, column };
      });

      return {
        symbol: typeof win.symbol === "string" ? win.symbol : "",
        cells,
        payout: normalizeMoney(win.payout ?? 0, "pagamento do grupo")
      };
    });
  }

  function normalizeSpinResult(result) {
    if (!result || typeof result !== "object") {
      throw new TypeError("O servidor não retornou o resultado do giro.");
    }

    return {
      grid: normalizeGrid(result.grid),
      wins: normalizeWins(result.wins),
      payout: normalizeMoney(result.payout, "pagamento"),
      balance: normalizeMoney(result.balance, "saldo")
    };
  }

  function setMessage(text, modifier = "") {
    elements.result.textContent = text;
    elements.result.className = modifier ? `result-msg ${modifier}` : "result-msg";
  }

  function updateUI() {
    elements.balance.textContent = `💰 ${formatMoney(balance)}`;
    elements.bet.textContent = formatMoney(bet);
  }

  function setBusy(isBusy) {
    spinning = isBusy;
    elements.spin.disabled = isBusy || !wallet;
    elements.betDown.disabled = isBusy;
    elements.betUp.disabled = isBusy;
    elements.reels.setAttribute("aria-busy", String(isBusy));
  }

  function buildReel(column, symbols) {
    const track = document.getElementById(`reelTrack${column}`);
    track.replaceChildren(...symbols.map(symbol => {
      const item = document.createElement("div");
      item.className = "symbol";
      item.textContent = symbol;
      return item;
    }));
  }

  function renderGrid(grid) {
    for (let column = 0; column < GRID_SIZE; column += 1) {
      buildReel(column, grid.map(row => row[column]));
      const track = document.getElementById(`reelTrack${column}`);
      track.style.transition = "none";
      track.style.transform = "translateY(0)";
    }
  }

  function createAnimationSymbols(count, column) {
    return Array.from({ length: count }, (_, index) =>
      DISPLAY_SYMBOLS[(index * 3 + column * 2) % DISPLAY_SYMBOLS.length]
    );
  }

  function animateGrid(grid) {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const animations = [];

    for (let column = 0; column < GRID_SIZE; column += 1) {
      animations.push(new Promise(resolve => {
        const track = document.getElementById(`reelTrack${column}`);
        const spinCount = reduceMotion ? 0 : 16 + column * 2;
        const finalSymbols = grid.map(row => row[column]);
        const cascade = [...createAnimationSymbols(spinCount, column), ...finalSymbols];
        const delay = reduceMotion ? 0 : column * 115 + 60;
        const duration = reduceMotion ? 1 : 850 + column * 135;

        buildReel(column, cascade);
        track.style.transition = "none";
        track.style.transform = "translateY(0)";

        window.setTimeout(() => {
          track.style.transition = `transform ${duration}ms cubic-bezier(0.16, 0.72, 0.3, 1)`;
          track.style.transform = `translateY(${-spinCount * SYMBOL_HEIGHT}px)`;
          window.setTimeout(resolve, duration + 80);
        }, delay);
      }));
    }

    return Promise.all(animations);
  }

  function highlightWins(wins) {
    wins.forEach(win => {
      win.cells.forEach(({ row, column }) => {
        const track = document.getElementById(`reelTrack${column}`);
        const firstVisibleIndex = track.children.length - GRID_SIZE;
        track.children[firstVisibleIndex + row]?.classList.add("connected");
      });
    });
  }

  function countWinningCells(wins) {
    return new Set(
      wins.flatMap(win => win.cells.map(cell => `${cell.row}:${cell.column}`))
    ).size;
  }

  function showSpinResult(result) {
    balance = queuedBalance ?? result.balance;
    queuedBalance = null;
    updateUI();
    highlightWins(result.wins);

    if (result.payout <= 0) {
      elements.lastWin.textContent = "—";
      setMessage("🌿 Conecte pelo menos 4 símbolos.", "msg-lose");
      return;
    }

    const winningCells = countWinningCells(result.wins);
    elements.lastWin.textContent = `+${formatMoney(result.payout)}`;

    if (result.payout >= bet * 50) {
      setMessage(`🎉 MEGA CONEXÃO! ${winningCells} ITENS • +${formatMoney(result.payout)} 🎉`, "msg-jackpot");
    } else if (result.payout >= bet * 10) {
      setMessage(`🐟 GRANDE CONEXÃO! ${winningCells} ITENS • +${formatMoney(result.payout)}`, "msg-win");
    } else {
      setMessage(`✨ ${winningCells} CONECTADOS • +${formatMoney(result.payout)}`, "msg-win");
    }
  }

  function friendlyError(error) {
    const code = String(error?.code || "").toUpperCase();
    const message = String(error?.message || "").toLowerCase();

    if (code.includes("INSUFFICIENT") || message.includes("saldo insuficiente")) {
      return "🌊 Saldo insuficiente para esta aposta.";
    }

    if (code.includes("AUTH") || message.includes("sessão") || message.includes("login")) {
      return "🔒 Sua sessão expirou. Entre novamente.";
    }

    if (error?.status === 429 || message.includes("limite") || message.includes("muitas jogadas")) {
      return "⏳ Muitas jogadas em pouco tempo. Aguarde alguns segundos.";
    }

    if (message.includes("network") || message.includes("fetch")) {
      return "🌐 Não foi possível falar com o servidor. Tente novamente.";
    }

    if (message.includes("jogada pendente")) {
      return error.message;
    }

    return "⚠️ Não foi possível concluir o giro. Tente novamente.";
  }

  async function refreshBalance() {
    if (!wallet) return;
    balance = normalizeBalancePayload(await wallet.getBalance());
    updateUI();
  }

  async function spin() {
    if (spinning || !wallet) return;

    queuedBalance = null;
    setBusy(true);
    setMessage("");
    elements.lastWin.textContent = "—";

    try {
      const result = normalizeSpinResult(await wallet.slotSpin(bet));
      await animateGrid(result.grid);
      showSpinResult(result);
    } catch (error) {
      try {
        await refreshBalance();
      } catch (balanceError) {
        console.error("Falha ao atualizar o saldo do Slot:", balanceError);
      }

      console.error("Falha ao girar o Slot:", error);
      setMessage(friendlyError(error), "msg-lose");
    } finally {
      setBusy(false);
      if (queuedBalance !== null) {
        balance = queuedBalance;
        queuedBalance = null;
        updateUI();
      }
    }
  }

  function getParentWallet() {
    try {
      const parentWallet = window.parent?.CasinoWallet;
      const hasRequiredMethods = parentWallet
        && typeof parentWallet.getBalance === "function"
        && typeof parentWallet.slotSpin === "function";

      return hasRequiredMethods ? parentWallet : null;
    } catch (error) {
      console.error("O Slot não conseguiu acessar a carteira da página principal:", error);
      return null;
    }
  }

  function delay(milliseconds) {
    return new Promise(resolve => window.setTimeout(resolve, milliseconds));
  }

  async function waitForWallet() {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const parentWallet = getParentWallet();
      if (parentWallet) return parentWallet;
      await delay(100);
    }

    return null;
  }

  function subscribeToBalance() {
    if (typeof wallet.subscribe !== "function") return;

    const subscription = wallet.subscribe(payload => {
      try {
        const nextBalance = normalizeBalancePayload(payload);
        if (spinning) {
          queuedBalance = nextBalance;
          return;
        }

        balance = nextBalance;
        updateUI();
      } catch (error) {
        console.error("Saldo recebido pelo Slot é inválido:", error);
      }
    });

    if (typeof subscription === "function") {
      unsubscribeFromWallet = subscription;
    } else if (subscription && typeof subscription.unsubscribe === "function") {
      unsubscribeFromWallet = () => subscription.unsubscribe();
    }
  }

  async function initialize() {
    renderGrid(INITIAL_GRID);
    updateUI();
    setBusy(true);
    setMessage("Conectando à sua carteira...");

    wallet = await waitForWallet();

    if (!wallet) {
      setMessage("⚠️ Abra o Slot pelo menu principal para acessar sua carteira.", "msg-lose");
      return;
    }

    subscribeToBalance();
    try {
      await refreshBalance();
      setMessage("");
    } catch (error) {
      console.error("Não foi possível carregar a carteira do Slot:", error);
      setMessage("🔒 Entre na sua conta para carregar o saldo.", "msg-lose");
    } finally {
      setBusy(false);
    }
  }

  elements.betUp.addEventListener("click", () => {
    if (spinning) return;
    bet = Math.min(bet + BET_STEP, BET_MAX);
    updateUI();
  });

  elements.betDown.addEventListener("click", () => {
    if (spinning) return;
    bet = Math.max(bet - BET_STEP, BET_MIN);
    updateUI();
  });

  elements.spin.addEventListener("click", spin);
  window.addEventListener("focus", () => {
    if (!spinning) {
      refreshBalance().catch(error => console.error("Falha ao sincronizar o saldo:", error));
    }
  });
  window.addEventListener("pagehide", () => unsubscribeFromWallet?.(), { once: true });

  initialize();
})();
