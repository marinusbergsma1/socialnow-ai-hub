/**
 * SocialNow AI Hub - Chat Assistant Module
 * Provides a smart local AI chat interface that searches the user's
 * knowledge base and offers built-in guidance on common AI topics.
 * All UI text is in Dutch.
 *
 * Depends on:
 *   - window.db        (Database instance from database.js)
 *   - window.supabaseClient (Supabase client from config.js)
 */

class ChatManager {
  constructor() {
    this.currentSessionId = null;
    this.sessions = [];
    this.messages = [];
  }

  // ===========================================================================
  // INITIALISATION
  // ===========================================================================

  /**
   * Bootstrap the chat module: bind DOM events and load existing sessions.
   */
  init() {
    this.setupEventListeners();
    this.loadSessions();
  }

  // ===========================================================================
  // EVENT LISTENERS
  // ===========================================================================

  setupEventListeners() {
    // Send button
    const btnSend = document.getElementById('btnSendChat');
    if (btnSend) {
      btnSend.addEventListener('click', () => this.sendMessage());
    }

    // Chat input: Enter to send, Shift+Enter for newline, auto-resize
    const chatInput = document.getElementById('chatInput');
    if (chatInput) {
      chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this.sendMessage();
        }
      });

      chatInput.addEventListener('input', () => {
        chatInput.style.height = 'auto';
        chatInput.style.height = Math.min(chatInput.scrollHeight, 200) + 'px';
      });
    }

    // New chat button
    const btnNew = document.getElementById('btnNewChat');
    if (btnNew) {
      btnNew.addEventListener('click', () => this.createNewSession());
    }

    // Suggestion buttons
    document.querySelectorAll('.chat-suggestion').forEach((btn) => {
      btn.addEventListener('click', () => {
        const prompt = btn.getAttribute('data-prompt');
        if (prompt) {
          const input = document.getElementById('chatInput');
          if (input) input.value = prompt;
          this.sendMessage();
        }
      });
    });

    // Attach resource button (placeholder – opens resource selector when built)
    const btnAttach = document.getElementById('btnAttachResource');
    if (btnAttach) {
      btnAttach.addEventListener('click', () => {
        this.openResourceSelector();
      });
    }

    // Delegate clicks inside session list (switch + delete)
    const sessionList = document.getElementById('chatSessionList');
    if (sessionList) {
      sessionList.addEventListener('click', (e) => {
        const deleteBtn = e.target.closest('.chat-session-delete');
        if (deleteBtn) {
          e.stopPropagation();
          const sessionId = deleteBtn.getAttribute('data-session-id');
          if (sessionId) this.deleteSession(sessionId);
          return;
        }

        const item = e.target.closest('.chat-session-item');
        if (item) {
          const sessionId = item.getAttribute('data-session-id');
          if (sessionId) this.loadSession(sessionId);
        }
      });
    }
  }

  // ===========================================================================
  // SESSION MANAGEMENT
  // ===========================================================================

  /**
   * Load all chat sessions for the current user and render them.
   */
  async loadSessions() {
    const userId = this.getUserId();
    if (!userId) return;

    try {
      const { data, error } = await window.db.getChatSessions(userId);
      if (error) {
        console.error('ChatManager: loadSessions error', error);
        return;
      }

      this.sessions = data || [];
      this.renderSessionList();
    } catch (err) {
      console.error('ChatManager: loadSessions failed', err);
    }
  }

  /**
   * Create a brand-new chat session and make it active.
   */
  async createNewSession() {
    const userId = this.getUserId();
    if (!userId) return;

    try {
      const { data, error } = await window.db.createChatSession({
        user_id: userId,
        title: 'Nieuwe chat'
      });

      if (error) {
        console.error('ChatManager: createNewSession error', error);
        return;
      }

      this.currentSessionId = data.id;
      this.messages = [];
      this.sessions.unshift(data);
      this.renderSessionList();
      this.showWelcomeScreen();

      return data;
    } catch (err) {
      console.error('ChatManager: createNewSession failed', err);
    }
  }

  /**
   * Switch to an existing session and load its messages.
   */
  async loadSession(sessionId) {
    this.currentSessionId = sessionId;

    try {
      const { data, error } = await window.db.getChatMessages(sessionId);
      if (error) {
        console.error('ChatManager: loadSession error', error);
        return;
      }

      this.messages = data || [];
      this.renderAllMessages();
      this.highlightActiveSession();
      this.scrollToBottom();
    } catch (err) {
      console.error('ChatManager: loadSession failed', err);
    }
  }

  /**
   * Delete a session and its messages, then clean up the UI.
   */
  async deleteSession(sessionId) {
    try {
      // Remove messages first (if cascade isn't set on the DB)
      await window.supabaseClient
        .from('chat_messages')
        .delete()
        .eq('session_id', sessionId);

      await window.supabaseClient
        .from('chat_sessions')
        .delete()
        .eq('id', sessionId);

      this.sessions = this.sessions.filter((s) => s.id !== sessionId);

      if (this.currentSessionId === sessionId) {
        this.currentSessionId = null;
        this.messages = [];
        this.showWelcomeScreen();
      }

      this.renderSessionList();
    } catch (err) {
      console.error('ChatManager: deleteSession failed', err);
    }
  }

  // ===========================================================================
  // SENDING & GENERATING MESSAGES
  // ===========================================================================

  /**
   * Send the user's message, generate a response, and persist both.
   */
  async sendMessage() {
    const input = document.getElementById('chatInput');
    if (!input) return;

    const text = input.value.trim();
    if (!text) return;

    // Ensure we have an active session
    if (!this.currentSessionId) {
      const session = await this.createNewSession();
      if (!session) return;
    }

    // Clear input and reset height
    input.value = '';
    input.style.height = 'auto';

    // Hide welcome screen if visible
    const welcome = document.querySelector('.chat-welcome');
    if (welcome) welcome.style.display = 'none';

    // --- User message ---
    const userMsg = {
      session_id: this.currentSessionId,
      role: 'user',
      content: text,
      created_at: new Date().toISOString()
    };
    this.messages.push(userMsg);
    this.appendMessage(userMsg);
    this.scrollToBottom();

    // Persist user message
    await window.db.addChatMessage({
      session_id: this.currentSessionId,
      role: 'user',
      content: text
    });

    // Show typing indicator
    this.showTypingIndicator();

    // --- Generate response ---
    const responseText = await this.generateResponse(text);

    // Remove typing indicator
    this.hideTypingIndicator();

    const assistantMsg = {
      session_id: this.currentSessionId,
      role: 'assistant',
      content: responseText,
      created_at: new Date().toISOString()
    };
    this.messages.push(assistantMsg);
    this.appendMessage(assistantMsg);
    this.scrollToBottom();

    // Persist assistant message
    await window.db.addChatMessage({
      session_id: this.currentSessionId,
      role: 'assistant',
      content: responseText
    });

    // Update session title if this was the first user message
    const userMessages = this.messages.filter((m) => m.role === 'user');
    if (userMessages.length === 1) {
      const newTitle = text.length > 50 ? text.substring(0, 50) + '...' : text;
      await window.supabaseClient
        .from('chat_sessions')
        .update({ title: newTitle })
        .eq('id', this.currentSessionId);

      const session = this.sessions.find((s) => s.id === this.currentSessionId);
      if (session) session.title = newTitle;
      this.renderSessionList();
    }
  }

  /**
   * Smart local response generation.
   * 1. Search the user's saved resources for relevant content.
   * 2. Match against the built-in AI knowledge base.
   * 3. Combine into a helpful response.
   */
  async generateResponse(userMessage) {
    // Small delay to mimic thinking
    await this.delay(600 + Math.random() * 800);

    const parts = [];

    // Step 1 – Search user resources
    const userId = this.getUserId();
    let foundResources = [];
    if (userId) {
      try {
        const keywords = this.extractKeywords(userMessage);
        if (keywords) {
          const { data } = await window.db.searchResources(userId, keywords);
          if (data && data.length > 0) {
            foundResources = data;
          }
        }
      } catch (err) {
        console.error('ChatManager: resource search failed', err);
      }
    }

    // Step 2 – Check built-in knowledge base
    const topicResponse = this.getTopicResponse(userMessage);

    // Step 3 – Build combined response
    if (topicResponse) {
      parts.push(topicResponse);
    }

    if (foundResources.length > 0) {
      parts.push(this.buildResourceSuggestions(foundResources));
    }

    // Fallback if nothing matched
    if (parts.length === 0) {
      parts.push(this.getFallbackResponse(userMessage));
    }

    return parts.join('\n\n');
  }

  // ===========================================================================
  // KEYWORD EXTRACTION
  // ===========================================================================

  /**
   * Strip common Dutch and English stop words and return significant terms
   * joined by spaces (suitable for the search_vector / ilike query).
   */
  extractKeywords(text) {
    const stopWords = new Set([
      // Dutch
      'de', 'het', 'een', 'en', 'van', 'in', 'is', 'op', 'dat', 'die', 'te',
      'er', 'aan', 'voor', 'met', 'als', 'zijn', 'was', 'ik', 'je', 'jij',
      'we', 'wij', 'ze', 'zij', 'hij', 'maar', 'niet', 'ook', 'nog', 'dan',
      'wel', 'naar', 'om', 'door', 'dit', 'wat', 'hoe', 'kan', 'kun', 'zou',
      'worden', 'wordt', 'over', 'uit', 'meer', 'al', 'bij', 'zo', 'geen',
      'mijn', 'jouw', 'ons', 'hun', 'waar', 'wie', 'wanneer', 'waarom',
      'moet', 'moeten', 'veel', 'heel', 'erg', 'heeft', 'hebben', 'deze',
      'kunt', 'gaan', 'ga', 'graag', 'wil', 'wilt', 'willen', 'ben', 'bent',
      // English
      'the', 'a', 'an', 'is', 'it', 'in', 'of', 'to', 'and', 'or', 'for',
      'on', 'at', 'by', 'with', 'from', 'as', 'are', 'was', 'be', 'been',
      'has', 'have', 'had', 'do', 'does', 'did', 'but', 'not', 'this',
      'that', 'what', 'how', 'can', 'will', 'would', 'should', 'could',
      'i', 'you', 'we', 'they', 'he', 'she', 'my', 'your', 'our', 'me',
      'about', 'which', 'some', 'more', 'very', 'just', 'also'
    ]);

    const words = text
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !stopWords.has(w));

    return words.join(' ');
  }

  // ===========================================================================
  // BUILT-IN KNOWLEDGE BASE
  // ===========================================================================

  /**
   * Match the user message against built-in AI topics and return a relevant
   * answer in Dutch. Returns null when no topic matches.
   */
  getTopicResponse(message) {
    const msg = message.toLowerCase();

    for (const topic of Object.values(KNOWLEDGE_BASE)) {
      const matched = topic.keywords.some((kw) => msg.includes(kw));
      if (matched) return topic.response;
    }

    return null;
  }

  /**
   * When nothing else matches, provide a friendly generic answer.
   */
  getFallbackResponse(message) {
    const responses = [
      'Dat is een interessante vraag! Ik heb helaas geen specifiek antwoord in mijn kennisbank gevonden. Probeer je vraag specifieker te stellen, of zoek in je opgeslagen resources.\n\nJe kunt me bijvoorbeeld vragen over:\n- **Prompt engineering** en hoe je betere prompts schrijft\n- **AI tools** zoals ChatGPT, Midjourney of Make\n- **Automatisering** met AI workflows\n- **Machine learning** basisconcepten\n- **AI voor marketing** en content creatie',

      'Goeie vraag! Ik kon geen direct antwoord vinden in je kennisbank. Hier zijn een paar tips:\n\n- Probeer specifiekere zoektermen te gebruiken\n- Sla relevante artikelen en video\'s op in je kennisbank zodat ik ze kan vinden\n- Stel vragen over specifieke AI-onderwerpen zoals prompt engineering, tools of automatisering\n\nIk sta klaar om je te helpen met alles rondom AI!',

      'Bedankt voor je vraag! Hoewel ik hier geen direct antwoord op heb, kan ik je helpen met veel AI-gerelateerde onderwerpen.\n\nProbeer eens:\n- **"Wat is prompt engineering?"** - Leer betere prompts schrijven\n- **"Welke AI tools zijn populair?"** - Ontdek handige tools\n- **"Hoe automatiseer ik met AI?"** - Maak workflows\n- **"AI trends"** - Blijf op de hoogte\n\nOf sla meer content op in je kennisbank, dan kan ik je nog beter helpen!'
    ];

    return responses[Math.floor(Math.random() * responses.length)];
  }

  // ===========================================================================
  // RESOURCE SUGGESTIONS
  // ===========================================================================

  /**
   * Format found resources as a list of suggestions (max 5).
   */
  buildResourceSuggestions(resources) {
    const max = Math.min(resources.length, 5);
    const typeLabels = window.APP_CONFIG?.RESOURCE_TYPES || {};

    let text = 'Ik heb deze relevante items in je kennisbank gevonden:\n\n';

    for (let i = 0; i < max; i++) {
      const r = resources[i];
      const typeLabel = typeLabels[r.type]?.label || r.type;
      const desc = r.description
        ? ' - ' + (r.description.length > 80
            ? r.description.substring(0, 80) + '...'
            : r.description)
        : '';
      text += `- **${r.title}** (${typeLabel})${desc}\n`;
    }

    if (resources.length > max) {
      text += `\n_...en nog ${resources.length - max} andere resultaten. Gebruik de zoekbalk om alles te bekijken._`;
    }

    return text;
  }

  // ===========================================================================
  // RESOURCE SELECTOR (placeholder)
  // ===========================================================================

  openResourceSelector() {
    // This will be implemented with the resources module.
    // For now show a toast or console message.
    console.log('ChatManager: resource selector not yet implemented');
    if (typeof window.showToast === 'function') {
      window.showToast('Resource koppelen wordt binnenkort beschikbaar', 'info');
    }
  }

  // ===========================================================================
  // RENDERING
  // ===========================================================================

  /**
   * Render all messages in #chatMessages from the current this.messages array.
   */
  renderAllMessages() {
    const container = document.getElementById('chatMessages');
    if (!container) return;

    // Hide welcome screen
    const welcome = container.querySelector('.chat-welcome');
    if (welcome) welcome.style.display = 'none';

    // Remove old message elements (keep the welcome element)
    container.querySelectorAll('.chat-message').forEach((el) => el.remove());

    this.messages.forEach((msg) => this.appendMessage(msg));
  }

  /**
   * Append a single message bubble to #chatMessages.
   */
  appendMessage(message) {
    const container = document.getElementById('chatMessages');
    if (!container) return;

    const html = this.renderMessage(message);
    container.insertAdjacentHTML('beforeend', html);

    // Re-initialise Lucide icons inside the new element
    if (typeof lucide !== 'undefined') {
      lucide.createIcons();
    }
  }

  /**
   * Build the HTML for a single chat message bubble.
   */
  renderMessage(message) {
    const isUser = message.role === 'user';
    const roleClass = isUser ? 'user' : 'assistant';
    const formattedContent = isUser
      ? this.escapeHtml(message.content)
      : this.formatChatContent(message.content);
    const time = this.formatTime(message.created_at);

    const copyBtn = isUser
      ? ''
      : `<button class="chat-copy-btn" title="Kopieer antwoord" onclick="window.chatManager.copyMessage(this)">
           <i data-lucide="copy"></i>
         </button>`;

    return `
      <div class="chat-message ${roleClass}">
        <div class="chat-message-avatar">
          ${isUser
            ? '<i data-lucide="user"></i>'
            : '<i data-lucide="bot"></i>'}
        </div>
        <div class="chat-message-body">
          <div class="chat-message-content">${formattedContent}</div>
          <div class="chat-message-meta">
            <span class="chat-message-time">${time}</span>
            ${copyBtn}
          </div>
        </div>
      </div>`;
  }

  /**
   * Show the animated typing indicator.
   */
  showTypingIndicator() {
    const container = document.getElementById('chatMessages');
    if (!container) return;

    const html = `
      <div class="chat-message assistant chat-typing-indicator" id="typingIndicator">
        <div class="chat-message-avatar">
          <i data-lucide="bot"></i>
        </div>
        <div class="chat-message-body">
          <div class="chat-message-content">
            <span class="typing-dots">
              <span class="typing-dot"></span>
              <span class="typing-dot"></span>
              <span class="typing-dot"></span>
            </span>
            <span class="typing-label">AI denkt na...</span>
          </div>
        </div>
      </div>`;

    container.insertAdjacentHTML('beforeend', html);

    if (typeof lucide !== 'undefined') {
      lucide.createIcons();
    }

    this.scrollToBottom();
  }

  /**
   * Remove the typing indicator from the DOM.
   */
  hideTypingIndicator() {
    const indicator = document.getElementById('typingIndicator');
    if (indicator) indicator.remove();
  }

  /**
   * Show the default welcome/empty state in the chat area.
   */
  showWelcomeScreen() {
    const container = document.getElementById('chatMessages');
    if (!container) return;

    // Remove all message bubbles
    container.querySelectorAll('.chat-message').forEach((el) => el.remove());

    // Show welcome
    const welcome = container.querySelector('.chat-welcome');
    if (welcome) welcome.style.display = '';
  }

  // ===========================================================================
  // SESSION LIST RENDERING
  // ===========================================================================

  /**
   * Render the sidebar list of chat sessions.
   */
  renderSessionList() {
    const list = document.getElementById('chatSessionList');
    if (!list) return;

    if (!this.sessions.length) {
      list.innerHTML = `
        <div class="chat-sessions-empty">
          <p>Nog geen chats. Klik op <strong>Nieuw</strong> om te beginnen.</p>
        </div>`;
      return;
    }

    list.innerHTML = this.sessions
      .map((s) => this.renderSessionItem(s))
      .join('');

    this.highlightActiveSession();
  }

  /**
   * HTML for a single session item in the sidebar.
   */
  renderSessionItem(session) {
    const date = this.formatDate(session.updated_at || session.created_at);
    const title = this.escapeHtml(session.title || 'Nieuwe chat');
    const activeClass = session.id === this.currentSessionId ? ' active' : '';

    return `
      <div class="chat-session-item${activeClass}" data-session-id="${session.id}">
        <div class="chat-session-info">
          <span class="chat-session-title">${title}</span>
          <span class="chat-session-date">${date}</span>
        </div>
        <button class="chat-session-delete btn-icon-sm" data-session-id="${session.id}" title="Verwijder chat">
          <i data-lucide="trash-2"></i>
        </button>
      </div>`;
  }

  /**
   * Add the .active class to the current session item in the sidebar.
   */
  highlightActiveSession() {
    const list = document.getElementById('chatSessionList');
    if (!list) return;

    list.querySelectorAll('.chat-session-item').forEach((el) => {
      el.classList.toggle(
        'active',
        el.getAttribute('data-session-id') === this.currentSessionId
      );
    });
  }

  // ===========================================================================
  // MARKDOWN-LIKE FORMATTING
  // ===========================================================================

  /**
   * Convert a subset of markdown syntax into safe HTML.
   */
  formatChatContent(text) {
    if (!text) return '';

    let html = this.escapeHtml(text);

    // Code blocks (``` ... ```)
    html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');

    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Bold
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

    // Italic (single * not preceded/followed by *)
    html = html.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');

    // Italic with underscore
    html = html.replace(/_(.+?)_/g, '<em>$1</em>');

    // Links [text](url)
    html = html.replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
    );

    // Bullet lists (lines starting with - )
    html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
    // Wrap consecutive <li> elements in <ul>
    html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');

    // Numbered lists (lines starting with a digit and dot)
    html = html.replace(/^\d+\.\s+(.+)$/gm, '<li>$1</li>');

    // Paragraphs: double line breaks
    html = html.replace(/\n{2,}/g, '</p><p>');
    // Single line breaks
    html = html.replace(/\n/g, '<br>');

    // Wrap in a paragraph tag
    html = '<p>' + html + '</p>';

    // Clean up empty paragraphs
    html = html.replace(/<p>\s*<\/p>/g, '');

    return html;
  }

  // ===========================================================================
  // COPY MESSAGE
  // ===========================================================================

  /**
   * Copy the text content of an assistant message to clipboard.
   */
  copyMessage(buttonEl) {
    const body = buttonEl.closest('.chat-message-body');
    if (!body) return;

    const content = body.querySelector('.chat-message-content');
    if (!content) return;

    const text = content.innerText || content.textContent;

    navigator.clipboard.writeText(text).then(() => {
      buttonEl.innerHTML = '<i data-lucide="check"></i>';
      if (typeof lucide !== 'undefined') lucide.createIcons();
      setTimeout(() => {
        buttonEl.innerHTML = '<i data-lucide="copy"></i>';
        if (typeof lucide !== 'undefined') lucide.createIcons();
      }, 2000);
    }).catch((err) => {
      console.error('ChatManager: clipboard copy failed', err);
    });
  }

  // ===========================================================================
  // UTILITIES
  // ===========================================================================

  /**
   * Smooth-scroll #chatMessages to the bottom.
   */
  scrollToBottom() {
    const container = document.getElementById('chatMessages');
    if (!container) return;

    requestAnimationFrame(() => {
      container.scrollTo({
        top: container.scrollHeight,
        behavior: 'smooth'
      });
    });
  }

  /**
   * Get the current authenticated user's id from Supabase.
   */
  getUserId() {
    try {
      const session = window.supabaseClient?.auth?.session?.();
      if (session?.user?.id) return session.user.id;

      // Newer Supabase v2 API stores user differently
      const user =
        window.supabaseClient?.auth?.getUser?.() ||
        window.currentUser;

      if (user?.id) return user.id;
      if (user?.data?.user?.id) return user.data.user.id;

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Escape HTML entities to prevent XSS in user-generated content.
   */
  escapeHtml(text) {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return text.replace(/[&<>"']/g, (c) => map[c]);
  }

  /**
   * Format an ISO timestamp as a short time string.
   */
  formatTime(isoString) {
    if (!isoString) return '';
    try {
      const d = new Date(isoString);
      return d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  }

  /**
   * Format an ISO timestamp as a short date string.
   */
  formatDate(isoString) {
    if (!isoString) return '';
    try {
      const d = new Date(isoString);
      const now = new Date();
      const diffMs = now - d;
      const diffDays = Math.floor(diffMs / 86400000);

      if (diffDays === 0) return 'Vandaag';
      if (diffDays === 1) return 'Gisteren';
      if (diffDays < 7) return `${diffDays} dagen geleden`;

      return d.toLocaleDateString('nl-NL', {
        day: 'numeric',
        month: 'short'
      });
    } catch {
      return '';
    }
  }

  /**
   * Simple promise-based delay.
   */
  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// =============================================================================
// BUILT-IN AI KNOWLEDGE BASE (Dutch)
// =============================================================================

const KNOWLEDGE_BASE = {

  prompt_engineering: {
    keywords: ['prompt engineering', 'prompt', 'prompts', 'prompting', 'prompt schrijven', 'betere prompts'],
    response:
      '**Prompt Engineering - De kunst van het vragen stellen aan AI**\n\n' +
      'Prompt engineering is de vaardigheid om effectieve instructies (prompts) te schrijven voor AI-modellen zoals ChatGPT. Hoe beter je prompt, hoe beter het resultaat.\n\n' +
      '**Basistechnieken:**\n\n' +
      '- **Wees specifiek** - Geef context, doelgroep en gewenst formaat aan. "Schrijf een LinkedIn-post over AI-trends voor marketeers, maximaal 200 woorden" werkt beter dan "schrijf iets over AI".\n' +
      '- **Geef voorbeelden** - Laat zien wat je bedoelt (few-shot prompting). Dit helpt de AI je stijl en verwachtingen te begrijpen.\n' +
      '- **Chain-of-Thought** - Vraag de AI om stap voor stap te denken: "Denk stap voor stap na over..." Dit levert betere analyses op.\n' +
      '- **Geef een rol** - "Je bent een ervaren social media manager..." helpt de AI de juiste toon aan te slaan.\n' +
      '- **Itereer** - De eerste prompt is zelden perfect. Verfijn je prompt op basis van het resultaat.\n\n' +
      '**Pro-tips:**\n' +
      '- Gebruik scheidingstekens (---) om secties te markeren\n' +
      '- Beperk de output met instructies als "maximaal 5 punten"\n' +
      '- Vraag om een specifiek formaat: tabel, lijst, JSON, etc.'
  },

  chatgpt_basics: {
    keywords: ['chatgpt', 'gpt', 'openai', 'gpt-4', 'gpt4', 'chatbot'],
    response:
      '**ChatGPT - Je persoonlijke AI-assistent**\n\n' +
      'ChatGPT is een AI-chatbot van OpenAI die tekst kan genereren, vragen beantwoorden, code schrijven, vertalingen maken en creatief meedenken.\n\n' +
      '**Tips voor betere resultaten:**\n\n' +
      '- **Context is alles** - Vertel wie je bent, wat je doet en waarvoor je het nodig hebt\n' +
      '- **Gebruik Custom Instructions** - Stel eenmalig je voorkeuren in zodat ChatGPT je altijd begrijpt\n' +
      '- **GPTs / Custom GPTs** - Maak of gebruik specialistische versies voor specifieke taken\n' +
      '- **Vraag om alternatieven** - "Geef me 3 verschillende versies" levert betere keuzes\n' +
      '- **Laat het verbeteren** - "Verbeter dit en maak het meer professioneel" werkt uitstekend\n\n' +
      '**Versies:**\n' +
      '- **GPT-4o** - Het snelste en meest veelzijdige model, kan ook afbeeldingen analyseren\n' +
      '- **GPT-4** - Krachtig model voor complexe taken\n' +
      '- **GPT-3.5** - Gratis beschikbaar, snel maar minder nauwkeurig\n\n' +
      '**Beperkingen:** ChatGPT kan fouten maken, verouderde informatie geven en "hallucineren" (dingen verzinnen). Controleer altijd belangrijke feiten.'
  },

  ai_tools_overview: {
    keywords: ['ai tools', 'tools', 'ai tool', 'welke tools', 'beste tools', 'overzicht tools', 'populaire tools'],
    response:
      '**Overzicht populaire AI Tools per categorie**\n\n' +
      '**Tekst & Chat:**\n' +
      '- **ChatGPT** (OpenAI) - Veelzijdige AI-assistent\n' +
      '- **Claude** (Anthropic) - Sterk in lange teksten en analyse\n' +
      '- **Gemini** (Google) - Geintegreerd met Google-diensten\n' +
      '- **Perplexity** - AI-zoekmachine met bronvermelding\n\n' +
      '**Afbeeldingen:**\n' +
      '- **Midjourney** - Hoogwaardige artistieke beelden\n' +
      '- **DALL-E 3** (OpenAI) - Geintegreerd in ChatGPT\n' +
      '- **Stable Diffusion** - Open-source beeldgeneratie\n' +
      '- **Adobe Firefly** - Commercieel veilig voor designers\n\n' +
      '**Video:**\n' +
      '- **Runway** - AI-video generatie en bewerking\n' +
      '- **HeyGen** - AI-presentatievideo\'s met avatars\n' +
      '- **Synthesia** - Professionele AI-video\'s\n\n' +
      '**Audio & Stem:**\n' +
      '- **ElevenLabs** - Realistische stemgeneratie\n' +
      '- **Whisper** (OpenAI) - Spraak naar tekst\n\n' +
      '**Productiviteit:**\n' +
      '- **Notion AI** - Schrijfhulp in Notion\n' +
      '- **Jasper** - Marketing content\n' +
      '- **Copy.ai** - Copywriting\n\n' +
      '**Code:**\n' +
      '- **GitHub Copilot** - AI-codeerassistent\n' +
      '- **Cursor** - AI-gedreven code-editor\n' +
      '- **Replit** - Online AI-ontwikkelomgeving'
  },

  automation_basics: {
    keywords: ['automation', 'automatisering', 'make', 'zapier', 'n8n', 'workflow', 'automatiseren'],
    response:
      '**AI Automatisering - Slimmer werken met workflows**\n\n' +
      'Met automatiseringstools kun je AI integreren in je dagelijkse werkprocessen zonder code te schrijven.\n\n' +
      '**Populaire platforms:**\n\n' +
      '- **Make** (voorheen Integromat) - Visuele workflow builder met 1500+ integraties. Sterk in complexe scenario\'s en heeft goede AI-modules.\n' +
      '- **Zapier** - Simpelste optie voor beginners. "Als dit gebeurt, doe dan dat" logica. 6000+ apps.\n' +
      '- **n8n** - Open-source alternatief, self-hosted mogelijk. Zeer flexibel voor developers.\n\n' +
      '**Voorbeelden van AI-automatiseringen:**\n\n' +
      '- Nieuwe e-mail ontvangen -> ChatGPT schrijft concept-antwoord -> Review in Gmail\n' +
      '- RSS-feed artikel -> AI samenvatting -> Publiceer op social media\n' +
      '- Formulierinzending -> AI categoriseert -> Voegt toe aan juiste spreadsheet\n' +
      '- Klantvraag in chat -> AI zoekt antwoord in kennisbank -> Stuurt automatisch reply\n\n' +
      '**Tips om te beginnen:**\n' +
      '- Start met een simpele automatisering (bijv. 2 stappen)\n' +
      '- Gebruik de gratis tiers om te experimenteren\n' +
      '- Automatiseer taken die je vaker dan 3x per week doet\n' +
      '- Test altijd grondig voordat je het in productie zet'
  },

  image_generation: {
    keywords: ['midjourney', 'dall-e', 'dalle', 'stable diffusion', 'afbeelding', 'afbeeldingen', 'beeldgeneratie', 'image generation', 'ai afbeeldingen', 'ai images'],
    response:
      '**AI Beeldgeneratie - Van tekst naar afbeelding**\n\n' +
      'AI kan verbluffende afbeeldingen maken op basis van tekstbeschrijvingen (prompts).\n\n' +
      '**De drie grote spelers:**\n\n' +
      '- **Midjourney** - Beste voor artistieke, esthetische beelden. Werkt via Discord. Uitstekend voor marketing en social media visuals.\n' +
      '- **DALL-E 3** - Van OpenAI, geintegreerd in ChatGPT. Zeer goed in het volgen van complexe instructies en tekst in afbeeldingen.\n' +
      '- **Stable Diffusion** - Open-source, draait lokaal op je computer. Maximale controle en privacy.\n\n' +
      '**Tips voor betere afbeeldingen:**\n\n' +
      '- **Beschrijf de stijl** - "in de stijl van een aquarel", "fotorealistisch", "minimalistisch"\n' +
      '- **Noem compositie** - "close-up", "vogelperspectief", "symmetrisch"\n' +
      '- **Voeg sfeer toe** - "warm licht", "dramatische belichting", "zonsondergang"\n' +
      '- **Specificeer details** - Hoe meer details, hoe beter het resultaat\n' +
      '- **Gebruik negatieve prompts** - Beschrijf wat je NIET wilt zien\n\n' +
      '**Let op:** Controleer altijd de licentie en gebruiksvoorwaarden voor commercieel gebruik van gegenereerde beelden.'
  },

  ai_for_marketing: {
    keywords: ['marketing', 'content', 'social media', 'content creatie', 'copywriting', 'advertenties', 'seo'],
    response:
      '**AI voor Marketing & Content Creatie**\n\n' +
      'AI kan je marketingworkflow enorm versnellen. Hier zijn de belangrijkste toepassingen:\n\n' +
      '**Content creatie:**\n' +
      '- Social media posts schrijven en plannen\n' +
      '- Blogartikelen en nieuwsbrieven opstellen\n' +
      '- Productbeschrijvingen genereren\n' +
      '- E-mail campagnes schrijven\n\n' +
      '**SEO & Strategie:**\n' +
      '- Keyword research en content planning\n' +
      '- Meta descriptions en titels optimaliseren\n' +
      '- Content gaps analyseren\n' +
      '- Concurrentieanalyse\n\n' +
      '**Visuele content:**\n' +
      '- Social media graphics maken met AI\n' +
      '- Producfoto\'s bewerken en verbeteren\n' +
      '- Video thumbnails genereren\n\n' +
      '**Handige tools voor marketeers:**\n' +
      '- **ChatGPT / Claude** - Teksten schrijven en brainstormen\n' +
      '- **Jasper** - Gespecialiseerd in marketing copy\n' +
      '- **Canva AI** - Designs met AI-functies\n' +
      '- **SurferSEO** - AI-gedreven SEO-optimalisatie\n' +
      '- **Buffer / Hootsuite** - Social media planning met AI\n\n' +
      '**Tip:** Gebruik AI als startpunt, niet als eindproduct. Voeg altijd je eigen stem en expertise toe!'
  },

  ai_for_coding: {
    keywords: ['coding', 'programming', 'programmeren', 'code', 'developer', 'ontwikkelaar', 'github copilot', 'cursor'],
    response:
      '**AI voor Programmeren & Ontwikkeling**\n\n' +
      'AI-codeerassistenten veranderen de manier waarop software wordt gebouwd fundamenteel.\n\n' +
      '**Populaire AI-codeertools:**\n\n' +
      '- **GitHub Copilot** - Autocomplete op steroiden. Begrijpt context en suggereert hele functies. Werkt in VS Code, JetBrains, etc.\n' +
      '- **Cursor** - AI-first code-editor gebouwd op VS Code. Chat met je codebase en laat AI wijzigingen doorvoeren.\n' +
      '- **Claude** (Anthropic) - Uitstekend voor complexe code-analyse en lange bestanden\n' +
      '- **ChatGPT** - Goed voor uitleg, debugging en prototyping\n' +
      '- **Replit** - Online IDE met AI-assistent ingebouwd\n\n' +
      '**Waar AI bij helpt:**\n\n' +
      '- Code schrijven en aanvullen\n' +
      '- Bugs vinden en fixen\n' +
      '- Code uitleggen en documenteren\n' +
      '- Tests schrijven\n' +
      '- Refactoring en optimalisatie\n' +
      '- Vertalen tussen programmeertalen\n\n' +
      '**Tips:**\n' +
      '- Beschrijf in commentaar wat je wilt voordat je code schrijft\n' +
      '- Review AI-gegenereerde code altijd zorgvuldig\n' +
      '- Gebruik AI voor boilerplate, schrijf kernlogica zelf\n' +
      '- Leer van de suggesties - het is ook een leerervaring!'
  },

  ai_trends: {
    keywords: ['trends', 'ai trends', 'toekomst', 'future', 'ontwikkelingen', 'nieuw'],
    response:
      '**Huidige AI Trends & Ontwikkelingen**\n\n' +
      'De AI-wereld verandert razendsnel. Dit zijn de belangrijkste trends:\n\n' +
      '- **Multimodale AI** - Modellen die tekst, beeld, audio en video tegelijk begrijpen en genereren. GPT-4o en Gemini lopen hierin voorop.\n\n' +
      '- **AI Agents** - Autonome AI-systemen die zelfstandig taken uitvoeren, tools gebruiken en beslissingen nemen. Denk aan AI die zelf onderzoek doet en rapporten schrijft.\n\n' +
      '- **Lokale AI / Edge AI** - AI-modellen die op je eigen device draaien, zonder cloud. Meer privacy en snelheid.\n\n' +
      '- **Open-source modellen** - LLaMA (Meta), Mistral en andere open modellen worden steeds krachtiger en democratiseren AI.\n\n' +
      '- **AI in elk product** - Van e-mail tot spreadsheets, AI wordt overal geintegreerd (Copilot in Office, Gemini in Google).\n\n' +
      '- **Video generatie** - Sora (OpenAI), Runway en andere tools maken het mogelijk om realistische video te genereren vanuit tekst.\n\n' +
      '- **RAG (Retrieval Augmented Generation)** - AI die je eigen documenten doorzoekt voor nauwkeurigere antwoorden.\n\n' +
      '- **AI-regelgeving** - De EU AI Act en andere wetgeving vormen kaders voor verantwoord AI-gebruik.\n\n' +
      '**Advies:** Blijf experimenteren en volg bronnen zoals AI-nieuwsbrieven, podcasts en communities om bij te blijven.'
  },

  learning_ai: {
    keywords: ['leren', 'learning', 'beginnen', 'starten', 'cursus', 'opleiding', 'hoe begin', 'waar begin'],
    response:
      '**AI Leren - Waar begin je?**\n\n' +
      'AI leren hoeft niet overweldigend te zijn. Hier is een praktisch stappenplan:\n\n' +
      '**Stap 1: Hands-on beginnen (Week 1-2)**\n' +
      '- Maak een gratis ChatGPT-account aan\n' +
      '- Experimenteer dagelijks met verschillende prompts\n' +
      '- Probeer taken uit je werk met AI te doen\n\n' +
      '**Stap 2: Prompt Engineering leren (Week 3-4)**\n' +
      '- Leer de basistechnieken: context geven, rollen toewijzen, voorbeelden gebruiken\n' +
      '- Sla je beste prompts op (in deze kennisbank!)\n' +
      '- Experimenteer met verschillende AI-tools\n\n' +
      '**Stap 3: Verdieping (Maand 2-3)**\n' +
      '- Kies een specialisatie: marketing, coding, design, automatisering\n' +
      '- Volg een online cursus op platforms als Coursera, Udemy of YouTube\n' +
      '- Begin met eenvoudige automatiseringen (Make/Zapier)\n\n' +
      '**Stap 4: Toepassen & Delen (Doorlopend)**\n' +
      '- Pas AI toe in je dagelijkse werk\n' +
      '- Deel je kennis met collega\'s\n' +
      '- Bouw een persoonlijke AI-toolkit\n\n' +
      '**Gratis leerbronnen:**\n' +
      '- Google AI Essentials (gratis cursus)\n' +
      '- OpenAI documentatie en tutorials\n' +
      '- YouTube kanalen over AI\n' +
      '- AI-communities op Reddit, Discord en LinkedIn\n\n' +
      '**Tip:** Sla alles wat je leert op in deze kennisbank. Zo bouw je je eigen AI-referentie op!'
  },

  ai_ethics: {
    keywords: ['ethiek', 'ethics', 'privacy', 'verantwoord', 'bias', 'risico', 'gevaar', 'veilig', 'veiligheid'],
    response:
      '**AI Ethiek - Verantwoord gebruik van AI**\n\n' +
      'Het is belangrijk om AI bewust en verantwoord in te zetten. Hier zijn de kernpunten:\n\n' +
      '**Privacy & Data:**\n' +
      '- Deel geen vertrouwelijke of persoonlijke gegevens met AI-tools\n' +
      '- Controleer de privacyinstellingen van je AI-tools\n' +
      '- Wees bewust van waar je data opgeslagen wordt\n' +
      '- Gebruik waar mogelijk lokale AI-modellen voor gevoelige data\n\n' +
      '**Bias & Nauwkeurigheid:**\n' +
      '- AI kan vooroordelen (bias) bevatten op basis van trainingsdata\n' +
      '- Controleer altijd belangrijke feiten en cijfers\n' +
      '- AI "hallucineert" soms - het verzint plausibel klinkende maar onjuiste informatie\n' +
      '- Gebruik meerdere bronnen voor kritische beslissingen\n\n' +
      '**Transparantie:**\n' +
      '- Wees eerlijk over het gebruik van AI in je werk\n' +
      '- Vermeld AI-assistentie wanneer gepast\n' +
      '- Claim AI-gegenereerd werk niet als puur eigen creatie\n\n' +
      '**Auteursrecht:**\n' +
      '- AI-gegenereerde content en auteursrecht is een grijs gebied\n' +
      '- Wees voorzichtig met het commercieel gebruik van AI-gegenereerde beelden\n' +
      '- Gebruik tools die "commercieel veilig" zijn (bijv. Adobe Firefly)\n\n' +
      '**Werkgelegenheid:**\n' +
      '- AI vervangt taken, niet per se banen\n' +
      '- Focus op vaardigheden die AI aanvullen: creativiteit, empathie, strategie\n' +
      '- Gebruik AI als productiviteitstool, niet als vervanging van menselijk denken'
  },

  machine_learning: {
    keywords: ['machine learning', 'neural network', 'neuraal netwerk', 'deep learning', 'algoritme', 'ai concept', 'hoe werkt ai'],
    response:
      '**Machine Learning - Hoe AI eigenlijk werkt**\n\n' +
      'Machine Learning (ML) is de technologie achter moderne AI. In het kort: computers leren patronen uit data.\n\n' +
      '**Basisconcepten:**\n\n' +
      '- **Machine Learning** - Een computer leert van voorbeelden in plaats van expliciete regels. Je geeft data, het model vindt patronen.\n' +
      '- **Neural Networks** - Gebaseerd op de structuur van het menselijk brein. Lagen van verbonden "neuronen" die informatie verwerken.\n' +
      '- **Deep Learning** - Neural networks met veel lagen (diep). Dit maakt complexe taken mogelijk zoals beeldherkenning en taalverwerking.\n' +
      '- **LLM (Large Language Model)** - Enorm taalmodel (zoals GPT-4) getraind op miljarden teksten. Dit is de technologie achter ChatGPT.\n\n' +
      '**Hoe een LLM werkt (simpel uitgelegd):**\n\n' +
      '1. Het model is getraind op enorme hoeveelheden tekst van het internet\n' +
      '2. Het leert patronen: welke woorden volgen op andere woorden\n' +
      '3. Bij een vraag voorspelt het de meest waarschijnlijke vervolgtekst\n' +
      '4. Extra training (RLHF) maakt het helpend en veilig\n\n' +
      '**Soorten ML:**\n' +
      '- **Supervised** - Leren met gelabelde voorbeelden\n' +
      '- **Unsupervised** - Patronen vinden zonder labels\n' +
      '- **Reinforcement** - Leren door beloning en straf\n\n' +
      '**Tip:** Je hoeft de technische details niet te kennen om AI effectief te gebruiken, maar basisbegrip helpt je betere resultaten te krijgen.'
  },

  api_basics: {
    keywords: ['api', 'api\'s', 'apis', 'koppeling', 'integratie', 'endpoint', 'rest api'],
    response:
      '**API\'s - De bouwstenen van AI-integratie**\n\n' +
      'Een API (Application Programming Interface) is een manier waarop software met andere software communiceert. Het is de "taal" waarmee apps met elkaar praten.\n\n' +
      '**Wat is een API in simpele termen?**\n\n' +
      'Stel je een restaurant voor: jij (de app) bestelt via de ober (API) bij de keuken (de server). Je hoeft niet te weten hoe de keuken werkt, alleen hoe je bestelt.\n\n' +
      '**AI API\'s:**\n' +
      '- **OpenAI API** - Toegang tot GPT-modellen, DALL-E, Whisper\n' +
      '- **Anthropic API** - Toegang tot Claude\n' +
      '- **Google AI API** - Gemini en andere Google AI-diensten\n' +
      '- **Stability AI** - Stable Diffusion API\n' +
      '- **ElevenLabs API** - Stemgeneratie\n\n' +
      '**Hoe gebruik je een API?**\n\n' +
      '1. Maak een account aan bij de API-provider\n' +
      '2. Genereer een API-sleutel (je "toegangspas")\n' +
      '3. Stuur verzoeken (requests) naar de API\n' +
      '4. Ontvang antwoorden (responses) terug\n\n' +
      '**Zonder code:**\n' +
      '- Gebruik **Make** of **Zapier** om API\'s visueel te koppelen\n' +
      '- Veel tools hebben ingebouwde integraties\n\n' +
      '**Tip:** Begin met no-code tools om API-concepten te leren voordat je zelf code schrijft.'
  }
};

// =============================================================================
// EXPOSE & INITIALISE
// =============================================================================

window.ChatManager = ChatManager;
window.chatManager = new ChatManager();
