(function setupAuthentication() {
  "use strict";

  const LEGACY_SESSION_KEY = "shannonAuthSession";

  const authScreen = document.getElementById("authScreen");
  const authForm = document.getElementById("authForm");
  const authName = document.getElementById("authName");
  const authEmail = document.getElementById("authEmail");
  const authPassword = document.getElementById("authPassword");
  const authPasswordConfirm = document.getElementById("authPasswordConfirm");
  const authSubmit = document.getElementById("authSubmit");
  const authSubmitLabel = authSubmit.querySelector("span");
  const authFeedback = document.getElementById("authFeedback");
  const logoutButton = document.getElementById("logoutButton");
  const menuUserName = document.getElementById("menuUserName");
  const tabs = [...document.querySelectorAll("[data-auth-mode]")];
  const registerFields = [...document.querySelectorAll(".register-only")];

  let currentMode = "login";
  let requestInProgress = false;
  let activeInterfaceUserId = null;

  function unloadGameFrames() {
    ["jogo-slot", "jogo-mines"].forEach(id => {
      document.getElementById(id)?.removeAttribute("src");
    });
  }

  function loadVisibleGame() {
    const casino = document.getElementById("cassino");
    if (!casino || casino.style.display === "none") return;

    const minesArea = document.getElementById("mines-area");
    const slotArea = document.getElementById("roletaArea");
    const frameId = minesArea?.style.display === "block"
      ? "jogo-mines"
      : slotArea?.style.display === "block"
        ? "jogo-slot"
        : null;

    if (frameId && typeof window.carregarJogo === "function") {
      window.carregarJogo(frameId);
    }
  }

  function switchGameUser(userId) {
    if (activeInterfaceUserId === userId) return;
    unloadGameFrames();
    activeInterfaceUserId = userId;
    if (userId) queueMicrotask(loadVisibleGame);
  }

  function clearLegacyDemoSession() {
    try {
      localStorage.removeItem(LEGACY_SESSION_KEY);
      sessionStorage.removeItem(LEGACY_SESSION_KEY);
    } catch {
      // O Supabase continuará sendo a única fonte válida de autenticação.
    }
  }

  function toInterfaceUser(user) {
    const email = typeof user?.email === "string" ? user.email : "";
    const metadata = user?.user_metadata || {};

    return {
      id: user?.id || null,
      email,
      name:
        metadata.name ||
        metadata.display_name ||
        email.split("@")[0] ||
        "Jogador"
    };
  }

  function showFeedback(message = "", type = "") {
    authFeedback.className = "auth-feedback";
    if (type) authFeedback.classList.add(type);
    authFeedback.textContent = message;
  }

  function getDisplayName(user) {
    return user.name || user.email?.split("@")[0] || "Jogador";
  }

  function unlockSite(user) {
    switchGameUser(user.id);
    document.body.classList.remove("auth-locked");
    authScreen.hidden = true;
    menuUserName.textContent = getDisplayName(user);
    showFeedback();
  }

  function lockSite({ clearFeedback = true, focusEmail = true } = {}) {
    switchGameUser(null);
    document.body.classList.add("auth-locked");
    authScreen.hidden = false;
    menuUserName.textContent = "Visitante";

    if (clearFeedback) showFeedback();
    if (focusEmail) setTimeout(() => authEmail.focus(), 50);
  }

  function setMode(mode) {
    currentMode = mode === "register" ? "register" : "login";
    const isRegister = currentMode === "register";

    authScreen.dataset.mode = currentMode;
    registerFields.forEach(field => { field.hidden = !isRegister; });
    authName.required = isRegister;
    authPasswordConfirm.required = isRegister;
    authPassword.autocomplete = isRegister ? "new-password" : "current-password";
    authSubmitLabel.textContent = isRegister ? "Criar conta" : "Acessar sistema";
    showFeedback();

    tabs.forEach(tab => {
      const active = tab.dataset.authMode === currentMode;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
    });
  }

  function setSubmitting(isSubmitting) {
    requestInProgress = isSubmitting;
    authSubmit.disabled = isSubmitting;
    authSubmit.classList.toggle("loading", isSubmitting);
    tabs.forEach(tab => { tab.disabled = isSubmitting; });

    authSubmitLabel.textContent = isSubmitting
      ? "Verificando..."
      : currentMode === "register"
        ? "Criar conta"
        : "Acessar sistema";
  }

  function getFriendlyAuthError(error) {
    const messages = {
      invalid_credentials: "E-mail ou senha inválidos.",
      email_not_confirmed: "Confirme seu e-mail antes de entrar.",
      email_exists: "Não foi possível criar a conta. Se já se cadastrou, tente entrar.",
      user_already_exists: "Não foi possível criar a conta. Se já se cadastrou, tente entrar.",
      weak_password: "A senha não atende aos requisitos de segurança.",
      email_address_invalid: "Digite um endereço de e-mail válido.",
      email_address_not_authorized: "O envio para este e-mail não está liberado no Supabase.",
      email_provider_disabled: "O cadastro por e-mail está desativado no Supabase.",
      signup_disabled: "Novos cadastros estão temporariamente desativados.",
      captcha_failed: "Não foi possível validar a proteção antirobô.",
      validation_failed: "Confira os dados informados e tente novamente.",
      unexpected_failure: "O serviço de autenticação encontrou um erro. Tente novamente."
    };

    if (messages[error?.code]) return messages[error.code];
    if (error?.status === 429) return "Muitas tentativas. Aguarde um pouco e tente novamente.";

    const errorMessage = String(error?.message || "").toLowerCase();
    if (error instanceof TypeError || errorMessage.includes("fetch")) {
      return "Não foi possível conectar ao Supabase. Verifique sua internet.";
    }

    return "Não foi possível autenticar agora. Tente novamente.";
  }

  function getEmailRedirectUrl() {
    const redirectUrl = new URL(window.location.href);
    redirectUrl.search = "";
    redirectUrl.hash = "";
    return redirectUrl.toString();
  }

  clearLegacyDemoSession();
  setMode("login");

  tabs.forEach(tab => {
    tab.addEventListener("click", () => setMode(tab.dataset.authMode));
  });

  const supabase = window.supabaseClient;

  if (!supabase?.auth) {
    lockSite({ focusEmail: false });
    authSubmit.disabled = true;
    showFeedback(
      window.supabaseConfigurationError ||
        "Configure a Project URL e a Publishable key em assets/js/supabase-client.js.",
      "error"
    );
    return;
  }

  async function registerWithSupabase({ name, email, password }) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { name, display_name: name },
        emailRedirectTo: getEmailRedirectUrl()
      }
    });

    if (error) throw error;

    return {
      user: data.user ? toInterfaceUser(data.user) : null,
      needsEmailConfirmation: !data.session
    };
  }

  async function loginWithSupabase({ email, password }) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) throw error;
    if (!data.user) throw new Error("Usuário não retornado pelo Supabase.");

    return toInterfaceUser(data.user);
  }

  authForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (requestInProgress) return;

    showFeedback();

    if (!authForm.checkValidity()) {
      authForm.reportValidity();
      return;
    }

    if (currentMode === "register" && authPassword.value !== authPasswordConfirm.value) {
      showFeedback("As senhas não são iguais.", "error");
      authPasswordConfirm.focus();
      return;
    }

    const payload = {
      name: authName.value.trim(),
      email: authEmail.value.trim().toLowerCase(),
      password: authPassword.value
    };

    setSubmitting(true);

    try {
      if (currentMode === "register") {
        const result = await registerWithSupabase(payload);

        if (result.needsEmailConfirmation) {
          authPassword.value = "";
          authPasswordConfirm.value = "";
          showFeedback(
            "Conta criada. Confirme o e-mail recebido antes de entrar.",
            "success"
          );
          return;
        }

        if (!result.user) throw new Error("Cadastro não concluído.");
        authForm.reset();
        unlockSite(result.user);
        return;
      }

      const user = await loginWithSupabase(payload);
      authForm.reset();
      unlockSite(user);
    } catch (error) {
      console.error("Falha de autenticação:", error?.code || error?.name || "erro desconhecido");
      showFeedback(getFriendlyAuthError(error), "error");
    } finally {
      setSubmitting(false);
    }
  });

  logoutButton.addEventListener("click", async event => {
    event.stopPropagation();

    const originalLabel = logoutButton.textContent;
    logoutButton.disabled = true;
    logoutButton.textContent = "Saindo...";

    try {
      const { error } = await supabase.auth.signOut({ scope: "local" });
      if (error) throw error;
    } catch (error) {
      console.error("Falha ao encerrar a sessão:", error?.code || error?.name || "erro desconhecido");
      logoutButton.disabled = false;
      logoutButton.textContent = "Não foi possível sair";
      logoutButton.title = getFriendlyAuthError(error);

      setTimeout(() => {
        logoutButton.textContent = originalLabel;
        logoutButton.title = "";
      }, 2500);
      return;
    }

    logoutButton.disabled = false;
    logoutButton.textContent = originalLabel;
    document.getElementById("menu").classList.remove("ativo");
    lockSite({ clearFeedback: false });
    showFeedback("Sessão encerrada.", "success");
  });

  supabase.auth.onAuthStateChange((event, session) => {
    if (session?.user) {
      unlockSite(toInterfaceUser(session.user));
      return;
    }

    if (event === "SIGNED_OUT") {
      document.getElementById("menu").classList.remove("ativo");
      lockSite({ clearFeedback: false });
      showFeedback("Sessão encerrada.", "success");
      return;
    }

    lockSite();
  });
})();
