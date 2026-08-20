(function initializeSupabase() {
  "use strict";

  const SUPABASE_URL = "https://tbfkqhbfnormkcaqipxf.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_4KeP0A_-M6YNip5e8RC58Q_Q_zfrGAP";

  function reportConfigurationError(message) {
    window.supabaseConfigurationError = message;
    console.error(`[Supabase] ${message}`);
  }

  if (!window.supabase?.createClient) {
    reportConfigurationError("A biblioteca do Supabase não foi carregada.");
    return;
  }

  const normalizedSupabaseUrl = SUPABASE_URL
    .trim()
    .replace(/\/rest\/v1\/?$/i, "")
    .replace(/\/+$/, "");
  const normalizedPublishableKey = SUPABASE_PUBLISHABLE_KEY.trim();
  const placeholderMarker = "COLE" + "_AQUI";
  const isPlaceholder =
    SUPABASE_URL.includes(placeholderMarker) ||
    SUPABASE_PUBLISHABLE_KEY.includes(placeholderMarker);

  let hasValidProjectUrl = false;

  try {
    const projectUrl = new URL(normalizedSupabaseUrl);
    hasValidProjectUrl =
      projectUrl.protocol === "https:" &&
      projectUrl.hostname.endsWith(".supabase.co") &&
      projectUrl.pathname === "/";
  } catch {
    hasValidProjectUrl = false;
  }

  const hasValidPublicKey =
    normalizedPublishableKey.startsWith("sb_publishable_") ||
    normalizedPublishableKey.startsWith("eyJ");

  if (isPlaceholder) {
    reportConfigurationError(
      "Preencha a Project URL e a Publishable key em assets/js/supabase-client.js."
    );
    return;
  }

  if (!hasValidProjectUrl || !hasValidPublicKey) {
    reportConfigurationError(
      "A Project URL ou a Publishable key do Supabase é inválida."
    );
    return;
  }

  try {
    window.supabaseClient = window.supabase.createClient(
      normalizedSupabaseUrl,
      normalizedPublishableKey,
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true
        }
      }
    );
  } catch {
    reportConfigurationError(
      "A Project URL ou a Publishable key do Supabase é inválida."
    );
  }
})();
