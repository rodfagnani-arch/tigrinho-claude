(function createCasinoWallet(global) {
  "use strict";

  const STORAGE_KEY = "saldoCassino";
  const DEFAULT_BALANCE = 1000;
  const CHANGE_EVENT = "casino:balance-changed";

  function normalize(value) {
    if (value === null || value === "") return null;
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) return null;
    return Math.round((number + Number.EPSILON) * 100) / 100;
  }

  function getBalance() {
    const storedBalance = normalize(localStorage.getItem(STORAGE_KEY));

    if (storedBalance !== null) return storedBalance;

    localStorage.setItem(STORAGE_KEY, String(DEFAULT_BALANCE));
    return DEFAULT_BALANCE;
  }

  function setBalance(value) {
    const balance = normalize(value);
    if (balance === null) throw new TypeError("O saldo precisa ser um número positivo.");

    localStorage.setItem(STORAGE_KEY, String(balance));
    global.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { balance } }));
    return balance;
  }

  function debit(amount) {
    const value = normalize(amount);
    const currentBalance = getBalance();

    if (value === null || value <= 0 || value > currentBalance) return false;

    setBalance(currentBalance - value);
    return true;
  }

  function credit(amount) {
    const value = normalize(amount);
    if (value === null || value < 0) throw new TypeError("O crédito precisa ser um número positivo.");

    return setBalance(getBalance() + value);
  }

  function subscribe(callback) {
    const onLocalChange = event => callback(event.detail.balance);
    const onStorageChange = event => {
      if (event.key === STORAGE_KEY) callback(getBalance());
    };

    global.addEventListener(CHANGE_EVENT, onLocalChange);
    global.addEventListener("storage", onStorageChange);

    return () => {
      global.removeEventListener(CHANGE_EVENT, onLocalChange);
      global.removeEventListener("storage", onStorageChange);
    };
  }

  global.CasinoWallet = Object.freeze({
    getBalance,
    setBalance,
    debit,
    credit,
    subscribe
  });
})(window);
