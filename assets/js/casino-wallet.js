(function createCasinoWallet(global) {
  "use strict";

  const CHANGE_EVENT = "casino:balance-changed";
  const CHANNEL_NAME = "shannon-casino-wallet";
  const LEGACY_KEYS = ["saldoCassino", "saldoCassinoVersion"];
  const PENDING_REQUEST_PREFIX = "shannonCasinoPendingRequest:";
  const ALLOWED_MINE_COUNTS = new Set([1, 3, 5, 10, 15]);
  const TERMINAL_MINE_STATUSES = new Set(["won", "lost", "cashed_out", "cancelled"]);
  let cachedBalance = null;
  let cachedWalletVersion = -1;
  let activeUserId = null;
  let balanceChannel = null;

  function removeLegacyBalance() {
    try {
      LEGACY_KEYS.forEach(key => localStorage.removeItem(key));
    } catch {
      // A carteira do Supabase não depende do armazenamento local antigo.
    }
  }

  function findSupabaseClient() {
    if (global.supabaseClient?.auth) return global.supabaseClient;

    try {
      if (global.parent !== global && global.parent.supabaseClient?.auth) {
        return global.parent.supabaseClient;
      }
    } catch {
      // Um iframe de outra origem não pode acessar o cliente da página principal.
    }

    return null;
  }

  function getSupabaseConfigurationError() {
    if (global.supabaseConfigurationError) return global.supabaseConfigurationError;

    try {
      return global.parent !== global
        ? global.parent.supabaseConfigurationError
        : null;
    } catch {
      return null;
    }
  }

  async function getSupabaseClient() {
    const configurationError = getSupabaseConfigurationError();
    if (configurationError) throw new Error(configurationError);

    const timeoutAt = Date.now() + 5000;

    while (Date.now() < timeoutAt) {
      const runtimeConfigurationError = getSupabaseConfigurationError();
      if (runtimeConfigurationError) throw new Error(runtimeConfigurationError);

      const client = findSupabaseClient();
      if (client) return client;
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    throw new Error(
      "Supabase indisponível. Abra o jogo pela página principal e entre na sua conta."
    );
  }

  function toCents(amount, fieldName = "valor") {
    const numericAmount = Number(amount);

    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      throw new TypeError(`O ${fieldName} precisa ser maior que zero.`);
    }

    const cents = Math.round((numericAmount + Number.EPSILON) * 100);
    if (!Number.isSafeInteger(cents)) {
      throw new TypeError(`O ${fieldName} informado é muito alto.`);
    }

    return cents;
  }

  function fromCents(value, fieldName = "valor") {
    const cents = Number(value);

    if (!Number.isSafeInteger(cents) || cents < 0) {
      throw new TypeError(`O ${fieldName} retornado pelo servidor é inválido.`);
    }

    return cents / 100;
  }

  function createRequestId() {
    if (typeof global.crypto?.randomUUID !== "function") {
      throw new Error("Este navegador não oferece identificadores seguros para as apostas.");
    }

    return global.crypto.randomUUID();
  }

  function normalizeWalletVersion(value) {
    const version = Number(value);
    if (!Number.isSafeInteger(version) || version < 0) {
      throw new TypeError("A versão da carteira retornada pelo servidor é inválida.");
    }
    return version;
  }

  function activateUser(userId) {
    if (activeUserId === userId) return;
    activeUserId = userId;
    cachedBalance = null;
    cachedWalletVersion = -1;
  }

  function notifyBalance(balance, {
    walletVersion,
    userId = activeUserId,
    broadcast = true,
    authoritative = false
  } = {}) {
    const normalizedBalance = Number(balance);
    if (!Number.isFinite(normalizedBalance) || normalizedBalance < 0) return null;
    if (typeof userId !== "string" || userId !== activeUserId) return null;

    const normalizedVersion = normalizeWalletVersion(walletVersion);
    if (normalizedVersion < cachedWalletVersion) {
      return cachedBalance;
    }

    const roundedBalance = Math.round((normalizedBalance + Number.EPSILON) * 100) / 100;
    if (
      !authoritative
      && normalizedVersion === cachedWalletVersion
      && cachedBalance !== null
      && roundedBalance !== cachedBalance
    ) {
      console.warn("Snapshot de saldo inconsistente; mantendo a versão já aplicada.");
      return cachedBalance;
    }

    cachedBalance = roundedBalance;
    cachedWalletVersion = normalizedVersion;
    global.dispatchEvent(new CustomEvent(CHANGE_EVENT, {
      detail: {
        balance: cachedBalance,
        walletVersion: cachedWalletVersion,
        userId: activeUserId
      }
    }));

    if (broadcast) {
      balanceChannel?.postMessage({
        balance: cachedBalance,
        walletVersion: cachedWalletVersion,
        userId: activeUserId
      });
    }

    return cachedBalance;
  }

  async function getFunctionErrorMessage(error) {
    try {
      const response = error?.context;
      if (response?.clone) {
        const payload = await response.clone().json();
        if (typeof payload?.message === "string") return payload.message;
        if (typeof payload?.error === "string") return payload.error;
      }
    } catch {
      // Usa uma mensagem segura abaixo quando a resposta não contém JSON.
    }

    const message = String(error?.message || "").toLowerCase();
    if (message.includes("fetch") || message.includes("network")) {
      return "Não foi possível conectar ao servidor do jogo.";
    }

    return "O servidor do jogo não conseguiu concluir a operação.";
  }

  function functionInvocationError(message, sourceError = null) {
    const status = Number(sourceError?.context?.status);
    const error = new Error(message);
    error.status = Number.isInteger(status) ? status : null;
    error.retryable = !Number.isInteger(status)
      || status === 408
      || status === 425
      || status === 429
      || status >= 500;
    return error;
  }

  async function invokeGame(
    functionName,
    body,
    providedClient = null,
    providedUserId = null
  ) {
    const supabase = providedClient || await getSupabaseClient();
    const userId = providedUserId || await authenticatedUserId(supabase);
    const { data, error } = await supabase.functions.invoke(functionName, { body });

    if (error) {
      throw functionInvocationError(await getFunctionErrorMessage(error), error);
    }
    if (typeof data?.error === "string") {
      throw functionInvocationError(data.message || data.error);
    }
    if (!data || typeof data !== "object") {
      throw functionInvocationError("O servidor do jogo retornou uma resposta inválida.");
    }

    Object.defineProperty(data, "__walletUserId", {
      value: userId,
      enumerable: false
    });
    return data;
  }

  const memoryPendingRequests = new Map();

  function pendingRequestKey(functionName, userId) {
    return `${PENDING_REQUEST_PREFIX}${userId}:${functionName}`;
  }

  function pendingRequest(functionName, userId) {
    const key = pendingRequestKey(functionName, userId);
    let request = memoryPendingRequests.get(key) || null;

    try {
      const storedValue = global.localStorage.getItem(key);
      if (storedValue) {
        request = JSON.parse(storedValue);
        memoryPendingRequests.set(key, request);
      } else {
        request = null;
        memoryPendingRequests.delete(key);
      }
    } catch {
      // Usa a cópia em memória quando o navegador bloqueia o armazenamento local.
    }

    const isValid = request
      && typeof request === "object"
      && request.userId === userId
      && typeof request.fingerprint === "string"
      && typeof request.requestId === "string"
      && request.requestId.length > 0
      && request.body
      && typeof request.body === "object";
    return isValid ? request : null;
  }

  function savePendingRequest(functionName, userId, request) {
    const key = pendingRequestKey(functionName, userId);
    try {
      global.localStorage.setItem(key, JSON.stringify(request));
      const confirmed = JSON.parse(global.localStorage.getItem(key) || "null");
      if (
        confirmed?.requestId !== request.requestId
        || confirmed?.fingerprint !== request.fingerprint
      ) {
        throw new Error("pending_request_not_persisted");
      }
      memoryPendingRequests.set(key, request);
    } catch {
      memoryPendingRequests.delete(key);
      throw new Error(
        "Não foi possível salvar a aposta com segurança neste navegador. "
        + "Libere o armazenamento do site antes de tentar novamente."
      );
    }
  }

  function clearPendingRequest(functionName, userId, requestId = null) {
    const key = pendingRequestKey(functionName, userId);
    const current = pendingRequest(functionName, userId);
    if (!current || (requestId && current.requestId !== requestId)) return;

    try {
      global.localStorage.removeItem(key);
      if (global.localStorage.getItem(key) !== null) {
        throw new Error("pending_request_not_removed");
      }
      memoryPendingRequests.delete(key);
    } catch {
      throw new Error(
        "A jogada foi confirmada, mas o navegador não liberou o registro local. "
        + "Verifique o armazenamento do site antes de continuar."
      );
    }
  }

  async function authenticatedUserId(supabase) {
    const { data, error } = await supabase.auth.getSession();
    const userId = data?.session?.user?.id;

    if (error || typeof userId !== "string" || !userId) {
      throw new Error("Entre na sua conta para usar a carteira.");
    }

    activateUser(userId);
    return userId;
  }

  async function performIdempotentStart(functionName, body, supabase, userId) {
    const fingerprint = JSON.stringify(body);
    let request = pendingRequest(functionName, userId);

    if (request && request.fingerprint !== fingerprint) {
      const pendingBet = fromCents(request.body?.betCents, "aposta pendente");
      throw new Error(
        `Existe uma jogada pendente de R$ ${pendingBet.toFixed(2).replace(".", ",")}. `
        + "Repita essa aposta para confirmar o resultado antes de iniciar outra."
      );
    }

    if (!request) {
      request = {
        userId,
        fingerprint,
        requestId: createRequestId(),
        body
      };
      savePendingRequest(functionName, userId, request);
    }

    try {
      const data = await invokeGame(functionName, {
        ...request.body,
        requestId: request.requestId
      }, supabase, userId);
      Object.defineProperty(data, "__walletRequestId", {
        value: request.requestId,
        enumerable: false
      });
      return data;
    } catch (error) {
      if (error?.retryable === false) {
        clearPendingRequest(functionName, userId, request.requestId);
      }
      throw error;
    }
  }

  async function invokeIdempotentStart(functionName, body, finalizeResponse) {
    const supabase = await getSupabaseClient();
    const userId = await authenticatedUserId(supabase);
    const perform = async () => {
      const data = await performIdempotentStart(
        functionName,
        body,
        supabase,
        userId
      );
      return finalizeResponse(data);
    };

    if (typeof global.navigator?.locks?.request === "function") {
      return global.navigator.locks.request(
        `shannon-casino:${userId}:${functionName}`,
        { mode: "exclusive" },
        perform
      );
    }

    throw new Error(
      "Este navegador não oferece coordenação segura entre abas. "
      + "Atualize o navegador para realizar apostas."
    );
  }

  function normalizeMinesResponse(data) {
    const normalized = { ...data };

    if (data.balanceCents !== undefined) {
      const responseBalance = fromCents(data.balanceCents, "saldo");
      const appliedBalance = notifyBalance(responseBalance, {
        walletVersion: data.walletVersion,
        userId: data.__walletUserId
      });
      if (appliedBalance === null) {
        throw new Error("A sessão mudou durante a operação. Abra o jogo novamente.");
      }
      normalized.balance = appliedBalance;
    }

    if (data.betCents !== undefined) {
      normalized.bet = fromCents(data.betCents, "aposta");
    }

    if (data.payoutCents !== undefined) {
      normalized.payout = fromCents(data.payoutCents, "prêmio");
    }

    if (data.potentialPayoutCents !== undefined) {
      normalized.potentialPayout = fromCents(
        data.potentialPayoutCents,
        "prêmio potencial"
      );
    }

    return normalized;
  }

  async function getBalance() {
    const supabase = await getSupabaseClient();
    const userId = await authenticatedUserId(supabase);
    const { data, error } = await supabase
      .from("wallets")
      .select("balance_cents, version")
      .single();

    if (error) throw new Error("Não foi possível carregar o saldo da carteira.");

    const balance = fromCents(data.balance_cents, "saldo");
    const appliedBalance = notifyBalance(balance, {
      walletVersion: data.version,
      userId,
      authoritative: true
    });
    if (appliedBalance === null) {
      throw new Error("A sessão mudou enquanto o saldo era carregado.");
    }
    return appliedBalance;
  }

  async function slotSpin(betAmount) {
    return invokeIdempotentStart(
      "slot-spin",
      { betCents: toCents(betAmount, "valor da aposta") },
      finalizeSlotSpin
    );
  }

  function finalizeSlotSpin(data) {
    if (
      data.roundId !== data.__walletRequestId
      || !Array.isArray(data.grid)
      || data.grid.length !== 5
      || !data.grid.every(row =>
        Array.isArray(row)
        && row.length === 5
        && row.every(symbol => typeof symbol === "string" && symbol.length > 0)
      )
      || !Array.isArray(data.wins)
      || !data.wins.every(win =>
        win
        && typeof win.symbol === "string"
        && Array.isArray(win.cells)
        && win.cells.length >= 4
        && win.cells.every(cell =>
          Number.isInteger(Number(cell?.row))
          && Number(cell.row) >= 0
          && Number(cell.row) < 5
          && Number.isInteger(Number(cell?.column))
          && Number(cell.column) >= 0
          && Number(cell.column) < 5
        )
      )
    ) {
      throw new Error("O Slot retornou uma grade inválida.");
    }

    const responseBalance = fromCents(data.balanceCents, "saldo");
    const payout = fromCents(data.payoutCents || 0, "prêmio");
    const wins = Array.isArray(data.wins)
      ? data.wins.map(win => ({
          ...win,
          payout: fromCents(win.payoutCents || 0, "prêmio do grupo")
        }))
      : [];

    const balance = notifyBalance(responseBalance, {
      walletVersion: data.walletVersion,
      userId: data.__walletUserId
    });
    if (balance === null) {
      throw new Error("A sessão mudou durante o giro. Abra o jogo novamente.");
    }

    clearPendingRequest("slot-spin", data.__walletUserId, data.__walletRequestId);

    return {
      grid: data.grid,
      wins,
      payout,
      balance
    };
  }

  async function minesStart(betAmount, mineCount) {
    const mines = Number(mineCount);
    if (!Number.isInteger(mines) || !ALLOWED_MINE_COUNTS.has(mines)) {
      throw new TypeError("Use 1, 3, 5, 10 ou 15 minas.");
    }

    return invokeIdempotentStart(
      "mines-start",
      {
        betCents: toCents(betAmount, "valor da aposta"),
        mineCount: mines
      },
      data => finalizeMinesStart(data, mines)
    );
  }

  async function finalizeMinesStart(data, mines) {
    const status = String(data.status || "").toLowerCase();
    if (data.roundId === data.__walletRequestId && TERMINAL_MINE_STATUSES.has(status)) {
      return minesState(data.roundId);
    }
    if (
      data.roundId === data.__walletRequestId
      && status === "active"
      && Number(data.safeRevealed) > 0
    ) {
      return minesState(data.roundId);
    }

    if (
      data.roundId !== data.__walletRequestId
      || status !== "active"
      || Number(data.mineCount) !== mines
      || data.balanceCents === undefined
      || data.walletVersion === undefined
    ) {
      throw new Error("O servidor não confirmou o início da rodada do Mines.");
    }

    const normalized = normalizeMinesResponse(data);
    clearPendingRequest("mines-start", data.__walletUserId, data.__walletRequestId);
    return normalized;
  }

  async function minesState(roundId = null) {
    if (roundId !== null && (typeof roundId !== "string" || !roundId)) {
      throw new TypeError("A rodada do Mines é inválida.");
    }

    const data = await invokeGame(
      "mines-state",
      roundId ? { roundId } : {}
    );
    const userId = data.__walletUserId;
    const pendingStart = pendingRequest("mines-start", userId);
    const status = String(data.status || "").toLowerCase();

    if (
      data.roundId
      && pendingStart
      && (status === "active" || pendingStart.requestId === data.roundId)
    ) {
      clearPendingRequest("mines-start", userId, pendingStart.requestId);
    }

    return normalizeMinesResponse(data);
  }

  async function minesReveal(roundId, cellIndex) {
    const cell = Number(cellIndex);
    if (typeof roundId !== "string" || !roundId) {
      throw new TypeError("A rodada do Mines é inválida.");
    }
    if (!Number.isInteger(cell) || cell < 0 || cell > 24) {
      throw new TypeError("A posição selecionada é inválida.");
    }

    const data = await invokeGame("mines-reveal", {
      roundId,
      cellIndex: cell
    });

    return normalizeMinesResponse(data);
  }

  async function minesCashout(roundId) {
    if (typeof roundId !== "string" || !roundId) {
      throw new TypeError("A rodada do Mines é inválida.");
    }

    const data = await invokeGame("mines-cashout", { roundId });
    return normalizeMinesResponse(data);
  }

  function subscribe(callback) {
    if (typeof callback !== "function") {
      throw new TypeError("A inscrição da carteira precisa de uma função.");
    }

    const onBalanceChange = event => callback(event.detail.balance);
    global.addEventListener(CHANGE_EVENT, onBalanceChange);

    if (cachedBalance !== null) {
      Promise.resolve().then(() => callback(cachedBalance));
    }

    return () => global.removeEventListener(CHANGE_EVENT, onBalanceChange);
  }

  function clearCachedBalance(broadcast = true) {
    const resetUserId = activeUserId;
    cachedBalance = null;
    cachedWalletVersion = -1;
    if (broadcast && resetUserId) {
      balanceChannel?.postMessage({ reset: true, userId: resetUserId });
    }
  }

  function synchronizeWithAuthentication() {
    const directClient = global.supabaseClient;
    if (!directClient?.auth?.onAuthStateChange) return;

    directClient.auth.onAuthStateChange((event, session) => {
      if (!session?.user) {
        if (event === "SIGNED_OUT" || event === "INITIAL_SESSION") {
          clearCachedBalance();
          activeUserId = null;
        }
        return;
      }

      if (event === "SIGNED_IN" || event === "INITIAL_SESSION") {
        activateUser(session.user.id);
        getBalance().catch(error => {
          console.error("Não foi possível sincronizar a carteira após o login:", error.message);
        });
      }
    });
  }

  removeLegacyBalance();

  if ("BroadcastChannel" in global) {
    balanceChannel = new global.BroadcastChannel(CHANNEL_NAME);
    balanceChannel.addEventListener("message", event => {
      if (event.data?.reset) {
        if (event.data.userId === activeUserId) clearCachedBalance(false);
        return;
      }

      if (
        event.data?.balance !== undefined
        && event.data.userId === activeUserId
      ) {
        try {
          notifyBalance(event.data.balance, {
            walletVersion: event.data.walletVersion,
            userId: event.data.userId,
            broadcast: false
          });
        } catch (error) {
          console.warn("Atualização de saldo inválida ignorada:", error.message);
        }
      }
    });
  }

  global.CasinoWallet = Object.freeze({
    getBalance,
    slotSpin,
    minesStart,
    minesState,
    minesReveal,
    minesCashout,
    subscribe
  });

  synchronizeWithAuthentication();
})(window);
