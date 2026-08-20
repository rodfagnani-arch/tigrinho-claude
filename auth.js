(function setupAuthentication() {
  "use strict";

  // Deixe vazio enquanto estiver usando o modo demonstrativo local.
  // Quando o backend servir este site, altere para: "/api"
  const API_BASE_URL = "";
  const SESSION_KEY = "shannonAuthSession";

  const authScreen = document.getElementById("authScreen");
  const authForm = document.getElementById("authForm");
  const authName = document.getElementById("authName");
  const authEmail = document.getElementById("authEmail");
  const authPassword = document.getElementById("authPassword");
  const authPasswordConfirm = document.getElementById("authPasswordConfirm");
  const authRemember = document.getElementById("authRemember");
  const authSubmit = document.getElementById("authSubmit");
  const authFeedback = document.getElementById("authFeedback");
  const logoutButton = document.getElementById("logoutButton");
  const menuUserName = document.getElementById("menuUserName");
  const tabs = [...document.querySelectorAll("[data-auth-mode]")];
  const registerFields = [...document.querySelectorAll(".register-only")];
  let currentMode = "login";

  function readSessionFrom(storage) {
    try {
      const value = storage.getItem(SESSION_KEY);
      return value ? JSON.parse(value) : null;
    } catch {
      return null;
    }
  }

  function getSession() {
    return readSessionFrom(sessionStorage) || readSessionFrom(localStorage);
  }

  function saveSession(user, remember) {
    const session = JSON.stringify({
      user: {
        id: user.id || null,
        name: user.name,
        email: user.email
      },
      createdAt: new Date().toISOString()
    });

    sessionStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(SESSION_KEY);
    (remember ? localStorage : sessionStorage).setItem(SESSION_KEY, session);
  }

  function clearSession() {
    sessionStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(SESSION_KEY);
  }

  function getDisplayName(user) {
    return user.name || user.email.split("@")[0];
  }

  function unlockSite(user) {
    document.body.classList.remove("auth-locked");
    authScreen.hidden = true;
    menuUserName.textContent = getDisplayName(user);
  }

  function lockSite() {
    document.body.classList.add("auth-locked");
    authScreen.hidden = false;
    authFeedback.textContent = "";
    setTimeout(() => authEmail.focus(), 50);
  }

  function setMode(mode) {
    currentMode = mode;
    const isRegister = mode === "register";

    authScreen.dataset.mode = mode;
    registerFields.forEach(field => { field.hidden = !isRegister; });
    authName.required = isRegister;
    authPasswordConfirm.required = isRegister;
    authPassword.autocomplete = isRegister ? "new-password" : "current-password";
    authSubmit.querySelector("span").textContent = isRegister ? "Criar conta" : "Acessar sistema";
    authFeedback.textContent = "";

    tabs.forEach(tab => {
      const active = tab.dataset.authMode === mode;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
    });
  }

  async function authenticate(mode, payload) {
    if (!API_BASE_URL) {
      await new Promise(resolve => setTimeout(resolve, 350));
      return {
        id: null,
        name: payload.name || payload.email.split("@")[0],
        email: payload.email
      };
    }

    const endpoint = mode === "register" ? "/auth/register" : "/auth/login";
    const response = await fetch(API_BASE_URL + endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) throw new Error(data.message || "Não foi possível autenticar.");
    return data.user;
  }

  tabs.forEach(tab => {
    tab.addEventListener("click", () => setMode(tab.dataset.authMode));
  });

  authForm.addEventListener("submit", async event => {
    event.preventDefault();
    authFeedback.className = "auth-feedback";
    authFeedback.textContent = "";

    if (!authForm.checkValidity()) {
      authForm.reportValidity();
      return;
    }

    if (currentMode === "register" && authPassword.value !== authPasswordConfirm.value) {
      authFeedback.classList.add("error");
      authFeedback.textContent = "As senhas não são iguais.";
      authPasswordConfirm.focus();
      return;
    }

    const payload = {
      name: authName.value.trim(),
      email: authEmail.value.trim().toLowerCase(),
      password: authPassword.value,
      remember: authRemember.checked
    };

    authSubmit.disabled = true;
    authSubmit.classList.add("loading");
    authSubmit.querySelector("span").textContent = "Verificando...";

    try {
      const user = await authenticate(currentMode, payload);
      if (API_BASE_URL) clearSession();
      else saveSession(user, authRemember.checked);
      authForm.reset();
      unlockSite(user);
    } catch (error) {
      authFeedback.classList.add("error");
      authFeedback.textContent = error.message;
    } finally {
      authSubmit.disabled = false;
      authSubmit.classList.remove("loading");
      authSubmit.querySelector("span").textContent = currentMode === "register" ? "Criar conta" : "Acessar sistema";
    }
  });

  logoutButton.addEventListener("click", async event => {
    event.stopPropagation();

    if (API_BASE_URL) {
      try {
        await fetch(API_BASE_URL + "/auth/logout", {
          method: "POST",
          credentials: "include"
        });
      } catch {
        // A sessão local ainda será encerrada se a API estiver indisponível.
      }
    }

    clearSession();
    document.getElementById("menu").classList.remove("ativo");
    lockSite();
  });

  async function restoreAuthentication() {
    if (!API_BASE_URL) {
      const existingSession = getSession();
      if (existingSession?.user?.email) unlockSite(existingSession.user);
      else lockSite();
      return;
    }

    lockSite();

    try {
      const response = await fetch(API_BASE_URL + "/auth/me", {
        credentials: "include"
      });
      if (!response.ok) return;

      const data = await response.json();
      if (data.user?.email) unlockSite(data.user);
    } catch {
      authFeedback.classList.add("error");
      authFeedback.textContent = "Servidor de autenticação indisponível.";
    }
  }

  restoreAuthentication();
})();
