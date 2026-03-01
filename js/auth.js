/**
 * SocialNow AI Hub - Authentication Module
 * Manages user authentication via Supabase Auth, profile loading,
 * and screen switching between auth and app views.
 * Depends on window.supabaseClient (initialised in config.js).
 */

class AuthManager {

  constructor() {
    this.supabase = window.supabaseClient;
    this.currentUser = null;
    this.currentProfile = null;
  }

  // ---------------------------------------------------------------------------
  // Initialization
  // ---------------------------------------------------------------------------

  /**
   * Set up the auth state listener, check the initial session,
   * and wire up all form and button event listeners.
   */
  async init() {
    // Listen for auth state changes (login, logout, token refresh)
    this.supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        this.currentUser = session.user;
        await this.loadProfile();
        this.showAppScreen();
      }

      if (event === 'SIGNED_OUT') {
        this.currentUser = null;
        this.currentProfile = null;
        this.showAuthScreen();
      }
    });

    // Check for an existing session on page load
    try {
      const { data: { session } } = await this.supabase.auth.getSession();

      if (session?.user) {
        this.currentUser = session.user;
        await this.loadProfile();
        this.showAppScreen();
      } else {
        this.showAuthScreen();
      }
    } catch (err) {
      console.error('[Auth] Fout bij ophalen sessie:', err);
      this.showAuthScreen();
    }

    // Wire up DOM event listeners
    this.setupEventListeners();
  }

  // ---------------------------------------------------------------------------
  // Event Listeners
  // ---------------------------------------------------------------------------

  /**
   * Attach submit handlers on the login/register forms,
   * click handlers on auth tabs and the logout button.
   */
  setupEventListeners() {
    // Login form
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
      loginForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const email = document.getElementById('loginEmail')?.value.trim();
        const password = document.getElementById('loginPassword')?.value;

        if (email && password) {
          this.login(email, password);
        }
      });
    }

    // Register form
    const registerForm = document.getElementById('registerForm');
    if (registerForm) {
      registerForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const displayName = document.getElementById('registerName')?.value.trim();
        const email = document.getElementById('registerEmail')?.value.trim();
        const password = document.getElementById('registerPassword')?.value;

        if (email && password && displayName) {
          this.register(email, password, displayName);
        }
      });
    }

    // Auth tab switching (login / register)
    const authTabs = document.getElementById('authTabs');
    if (authTabs) {
      authTabs.addEventListener('click', (e) => {
        const tab = e.target.closest('.auth-tab');
        if (!tab) return;

        const targetTab = tab.dataset.tab;

        // Update active tab styling
        authTabs.querySelectorAll('.auth-tab').forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');

        // Show the matching form, hide the other
        const loginFormEl = document.getElementById('loginForm');
        const registerFormEl = document.getElementById('registerForm');

        if (targetTab === 'login') {
          if (loginFormEl) loginFormEl.classList.remove('hidden');
          if (registerFormEl) registerFormEl.classList.add('hidden');
        } else if (targetTab === 'register') {
          if (loginFormEl) loginFormEl.classList.add('hidden');
          if (registerFormEl) registerFormEl.classList.remove('hidden');
        }

        // Clear any visible error messages when switching tabs
        this.clearError('loginError');
        this.clearError('registerError');
      });
    }

    // Logout button
    const logoutBtn = document.getElementById('btnLogout');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => {
        this.logout();
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Authentication Methods
  // ---------------------------------------------------------------------------

  /**
   * Sign in with email and password.
   * @param {string} email
   * @param {string} password
   */
  async login(email, password) {
    try {
      const { error } = await this.supabase.auth.signInWithPassword({
        email,
        password
      });

      if (error) {
        const message = this._translateAuthError(error.message);
        this.showError('loginError', message);
      }
      // On success the onAuthStateChange listener handles the rest.
    } catch (err) {
      console.error('[Auth] Login fout:', err);
      this.showError('loginError', 'Er ging iets mis bij het inloggen. Probeer het opnieuw.');
    }
  }

  /**
   * Register a new account with email, password, and display name.
   * @param {string} email
   * @param {string} password
   * @param {string} displayName
   */
  async register(email, password, displayName) {
    try {
      const { data, error } = await this.supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            display_name: displayName
          }
        }
      });

      if (error) {
        const message = this._translateAuthError(error.message);
        this.showError('registerError', message);
        return;
      }

      // Supabase may auto-confirm or require e-mail verification.
      // If the user object exists but has no session, verification is required.
      if (data?.user && !data.session) {
        this.showError('registerError', 'Check je e-mail voor de verificatielink!', 'success');
      }
      // If a session is returned the onAuthStateChange listener picks it up automatically.
    } catch (err) {
      console.error('[Auth] Registratie fout:', err);
      this.showError('registerError', 'Er ging iets mis bij het registreren. Probeer het opnieuw.');
    }
  }

  /**
   * Sign out the current user.
   */
  async logout() {
    try {
      await this.supabase.auth.signOut();
      // onAuthStateChange listener handles the UI switch.
    } catch (err) {
      console.error('[Auth] Uitloggen fout:', err);
    }
  }

  // ---------------------------------------------------------------------------
  // Profile
  // ---------------------------------------------------------------------------

  /**
   * Fetch the user's profile from the profiles table and update
   * relevant UI elements (name, avatar, dashboard greeting).
   */
  async loadProfile() {
    if (!this.currentUser) return;

    try {
      const { data, error } = await this.supabase
        .from('profiles')
        .select('*')
        .eq('id', this.currentUser.id)
        .single();

      if (error) {
        console.warn('[Auth] Profiel ophalen mislukt:', error.message);
        // Fall back to auth metadata
        this.currentProfile = null;
        this._updateProfileUI();
        return;
      }

      this.currentProfile = data;
      this._updateProfileUI();
    } catch (err) {
      console.error('[Auth] Profiel fout:', err);
      this.currentProfile = null;
      this._updateProfileUI();
    }
  }

  /**
   * Push profile data into the DOM elements that display user info.
   * Falls back to auth metadata or generic defaults.
   */
  _updateProfileUI() {
    // Resolve display name from profile, then auth metadata, then email
    const displayName =
      this.currentProfile?.display_name ||
      this.currentProfile?.full_name ||
      this.currentUser?.user_metadata?.display_name ||
      this.currentUser?.email?.split('@')[0] ||
      'Gebruiker';

    // Sidebar user name
    const userNameEl = document.getElementById('userName');
    if (userNameEl) {
      userNameEl.textContent = displayName;
    }

    // Dashboard greeting
    const dashboardNameEl = document.getElementById('dashboardName');
    if (dashboardNameEl) {
      dashboardNameEl.textContent = displayName;
    }

    // Avatar — show initials or a profile image
    const avatarEl = document.getElementById('userAvatar');
    if (avatarEl) {
      const avatarUrl = this.currentProfile?.avatar_url;

      if (avatarUrl) {
        avatarEl.innerHTML = `<img src="${avatarUrl}" alt="${displayName}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;">`;
      } else {
        // Show first letter as initial
        const initial = displayName.charAt(0).toUpperCase();
        avatarEl.innerHTML = `<span style="font-weight:600;font-size:14px;">${initial}</span>`;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Screen Switching
  // ---------------------------------------------------------------------------

  /**
   * Show the authentication screen and hide the application.
   */
  showAuthScreen() {
    const authScreen = document.getElementById('authScreen');
    const appScreen = document.getElementById('appScreen');

    if (authScreen) {
      authScreen.classList.remove('hidden');
      authScreen.classList.add('fade-in');
    }

    if (appScreen) {
      appScreen.classList.add('hidden');
    }
  }

  /**
   * Show the main application and hide the auth screen.
   * Notifies other modules that the user has logged in.
   */
  showAppScreen() {
    const authScreen = document.getElementById('authScreen');
    const appScreen = document.getElementById('appScreen');

    if (authScreen) {
      authScreen.classList.add('hidden');
      authScreen.classList.remove('fade-in');
    }

    if (appScreen) {
      appScreen.classList.remove('hidden');
      appScreen.classList.add('fade-in');
    }

    // Notify the main app controller that login is complete
    if (window.App && typeof window.App.onLogin === 'function') {
      window.App.onLogin();
    }
  }

  // ---------------------------------------------------------------------------
  // Error Display
  // ---------------------------------------------------------------------------

  /**
   * Display an error (or success) message in the specified element.
   * Automatically clears the message after 5 seconds.
   * @param {string} elementId  - DOM id of the error container.
   * @param {string} message    - Text to display.
   * @param {string} [type]     - 'error' (default) or 'success' for styling.
   */
  showError(elementId, message, type = 'error') {
    const el = document.getElementById(elementId);
    if (!el) return;

    el.textContent = message;
    el.className = `auth-error ${type === 'success' ? 'auth-success' : ''}`;

    // Auto-clear after 5 seconds
    setTimeout(() => {
      this.clearError(elementId);
    }, 5000);
  }

  /**
   * Clear the contents of an error element.
   * @param {string} elementId
   */
  clearError(elementId) {
    const el = document.getElementById(elementId);
    if (!el) return;

    el.textContent = '';
    el.className = 'auth-error';
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Translate common Supabase auth error messages into user-friendly Dutch.
   * @param {string} message - Original English error message from Supabase.
   * @returns {string}
   */
  _translateAuthError(message) {
    if (!message) return 'Er is een onbekende fout opgetreden.';

    const lower = message.toLowerCase();

    if (lower.includes('invalid login credentials') || lower.includes('invalid_credentials')) {
      return 'Onjuist e-mailadres of wachtwoord.';
    }
    if (lower.includes('email not confirmed')) {
      return 'Je e-mailadres is nog niet bevestigd. Check je inbox.';
    }
    if (lower.includes('user already registered') || lower.includes('already been registered')) {
      return 'Dit e-mailadres is al geregistreerd. Probeer in te loggen.';
    }
    if (lower.includes('password') && lower.includes('least')) {
      return 'Je wachtwoord moet minimaal 6 tekens bevatten.';
    }
    if (lower.includes('rate limit') || lower.includes('too many requests')) {
      return 'Te veel pogingen. Wacht even en probeer het opnieuw.';
    }
    if (lower.includes('network') || lower.includes('fetch')) {
      return 'Netwerkfout. Controleer je internetverbinding.';
    }
    if (lower.includes('email') && lower.includes('invalid')) {
      return 'Voer een geldig e-mailadres in.';
    }
    if (lower.includes('signup is disabled')) {
      return 'Registratie is momenteel uitgeschakeld.';
    }

    // Fallback: return the original message
    return message;
  }
}

// ---------------------------------------------------------------------------
// Expose globally & instantiate
// ---------------------------------------------------------------------------
window.AuthManager = AuthManager;
window.authManager = new AuthManager();
