/**
 * SocialNow AI Hub - Resource Management Module
 * Handles adding, editing, deleting, auto-categorising and displaying resources.
 * Depends on: window.db (Database), window.ui (UI helpers), window.authManager,
 *             window.APP_CONFIG (config.js).
 */

class ResourceManager {
  constructor() {
    /** @type {Array} Cached categories from the database */
    this.categories = [];
    /** @type {Array} Cached folders from the database */
    this.folders = [];
    /** @type {Array} Cached tags from the database */
    this.tags = [];

    // Currently-editing resource id (null when creating new)
    this._editingId = null;
    // Currently selected folder in folder-view
    this._selectedFolderId = null;
    // Colour chosen in folder modal
    this._folderColor = '#25D366';
  }

  // ===========================================================================
  // INITIALISATION
  // ===========================================================================

  /**
   * Bootstrap the resource manager: load reference data, bind event listeners.
   */
  async init() {
    try {
      await Promise.all([
        this.loadCategories(),
        this.loadFolders(),
        this.loadTags()
      ]);
    } catch (err) {
      console.error('ResourceManager: initialisatie mislukt', err);
    }

    this._bindEventListeners();
    this._bindModalDismiss();
    this._bindQuickAddTiles();
    this._bindViewChangedEvent();

    console.info('ResourceManager: gereed');
  }

  // ---------------------------------------------------------------------------
  // Reference-data loaders
  // ---------------------------------------------------------------------------

  /**
   * Fetch categories from the database, populate sidebar and dropdowns.
   */
  async loadCategories() {
    const userId = this._userId();
    if (!userId) return;

    const { data, error } = await window.db.getCategories(userId);
    if (error) {
      console.error('ResourceManager: categorien laden mislukt', error);
      return;
    }

    this.categories = data || [];

    // Sidebar
    const sidebar = document.getElementById('sidebarCategories');
    if (sidebar) {
      sidebar.innerHTML = this.categories.map((cat) => `
        <button class="sidebar-category" data-category-id="${cat.id}" title="${cat.name}">
          <span class="sidebar-category-dot" style="background:${cat.color || '#25D366'}"></span>
          <span>${cat.name}</span>
        </button>
      `).join('');

      sidebar.querySelectorAll('.sidebar-category').forEach((btn) => {
        btn.addEventListener('click', () => {
          this._filterByCategory(btn.dataset.categoryId);
        });
      });
    }

    // Dropdowns
    this._populateCategoryDropdown('resourceCategory');
    this._populateCategoryDropdown('videoFilter');
  }

  /**
   * Fetch folders from the database, populate dropdowns and folder tree.
   */
  async loadFolders() {
    const userId = this._userId();
    if (!userId) return;

    const { data, error } = await window.db.getFolders(userId);
    if (error) {
      console.error('ResourceManager: mappen laden mislukt', error);
      return;
    }

    this.folders = data || [];

    // Resource form dropdown
    this._populateFolderDropdown('resourceFolder');
    // Folder modal parent dropdown
    this._populateFolderDropdown('folderParent');
    // Folder tree in folder view
    this._renderFolderTree();
  }

  /**
   * Fetch tags from the database and cache locally.
   */
  async loadTags() {
    const userId = this._userId();
    if (!userId) return;

    const { data, error } = await window.db.getTags(userId);
    if (error) {
      console.error('ResourceManager: tags laden mislukt', error);
      return;
    }

    this.tags = data || [];
  }

  // ===========================================================================
  // RESOURCE CRUD
  // ===========================================================================

  /**
   * Open the resource modal in "add" mode.
   * @param {string} type - Resource type, defaults to 'bookmark'.
   */
  openAddModal(type = 'bookmark') {
    this._editingId = null;

    const modal = document.getElementById('modalResource');
    const form = document.getElementById('resourceForm');
    const title = document.getElementById('modalResourceTitle');

    if (!modal || !form) return;

    form.reset();
    if (title) title.innerHTML = '<i data-lucide="plus-circle"></i> Resource toevoegen';

    const typeSelect = document.getElementById('resourceType');
    if (typeSelect) typeSelect.value = type;

    this._toggleVideoFields(type);
    this._clearUrlPreview();
    this._openModal(modal);
  }

  /**
   * Open the resource modal in "edit" mode for the given resource.
   * @param {string} resourceId
   */
  async openEditModal(resourceId) {
    const { data: resource, error } = await window.db.getResource(resourceId);
    if (error || !resource) {
      this._toast('Fout bij het ophalen van de resource.', 'error');
      return;
    }

    this._editingId = resource.id;

    const modal = document.getElementById('modalResource');
    const title = document.getElementById('modalResourceTitle');
    if (title) title.innerHTML = '<i data-lucide="pencil"></i> Resource bewerken';

    // Populate form fields
    this._setVal('resourceUrl', resource.url || '');
    this._setVal('resourceTitle', resource.title || '');
    this._setVal('resourceType', resource.type || 'bookmark');
    this._setVal('resourceDescription', resource.description || '');
    this._setVal('resourceFolder', resource.folder_id || '');
    this._setVal('resourceCategory', resource.category_id || '');
    this._setVal('resourceNotes', resource.personal_notes || '');

    // Tags
    if (resource.resource_tags && resource.resource_tags.length) {
      const tagNames = resource.resource_tags
        .map((rt) => rt.tags?.name)
        .filter(Boolean)
        .join(', ');
      this._setVal('resourceTags', tagNames);
    } else {
      this._setVal('resourceTags', '');
    }

    this._toggleVideoFields(resource.type);
    this._openModal(modal);
  }

  /**
   * Gather form data and create or update the resource.
   */
  async saveResource() {
    const userId = this._userId();
    if (!userId) return;

    const url = this._getVal('resourceUrl');
    const title = this._getVal('resourceTitle');
    const type = this._getVal('resourceType') || 'bookmark';
    const description = this._getVal('resourceDescription');
    const folderId = this._getVal('resourceFolder') || null;
    const categoryId = this._getVal('resourceCategory') || null;
    const personalNotes = this._getVal('resourceNotes');
    const tagsRaw = this._getVal('resourceTags');

    if (!title) {
      this._toast('Vul een titel in.', 'warning');
      return;
    }

    const resourceData = {
      user_id: userId,
      url: url || null,
      title,
      type,
      description: description || null,
      folder_id: folderId,
      category_id: categoryId,
      personal_notes: personalNotes || null,
      status: folderId ? 'sorted' : 'inbox'
    };

    // Auto-categorise when no manual category chosen
    if (!categoryId && window.APP_CONFIG.AUTO_CATEGORIZE) {
      const autoCategory = this.autoCategorize({ title, description, url });
      if (autoCategory) {
        resourceData.category_id = autoCategory.id;
      }
    }

    // Auto-detect difficulty
    const combinedText = [title, description].filter(Boolean).join(' ');
    const difficulty = this.autoDetectDifficulty(combinedText);
    if (difficulty) {
      resourceData.ai_difficulty = difficulty;
    }

    try {
      let result;

      if (this._editingId) {
        // Update
        result = await window.db.updateResource(this._editingId, resourceData);
      } else {
        // Create
        result = await window.db.createResource(resourceData);
      }

      if (result.error) {
        this._toast('Fout bij opslaan: ' + (result.error.message || 'onbekende fout'), 'error');
        return;
      }

      // Handle tags
      if (result.data && tagsRaw) {
        await this._syncTags(result.data.id, tagsRaw, userId);
      }

      // Log activity
      const action = this._editingId ? 'updated' : 'created';
      await window.db.logActivity(userId, action, type, result.data?.id || this._editingId);

      this._closeModal(document.getElementById('modalResource'));
      this._toast(
        this._editingId ? 'Resource bijgewerkt!' : 'Resource toegevoegd!',
        'success'
      );

      this._editingId = null;
      this._refreshCurrentView();
    } catch (err) {
      console.error('ResourceManager: opslaan mislukt', err);
      this._toast('Er ging iets mis bij het opslaan.', 'error');
    }
  }

  /**
   * Delete a resource after user confirmation.
   * @param {string} resourceId
   */
  async deleteResource(resourceId) {
    if (!confirm('Weet je zeker dat je dit wilt verwijderen?')) return;

    const { error } = await window.db.deleteResource(resourceId);
    if (error) {
      this._toast('Verwijderen mislukt.', 'error');
      return;
    }

    const userId = this._userId();
    if (userId) {
      await window.db.logActivity(userId, 'deleted', 'resource', resourceId);
    }

    this._toast('Resource verwijderd.', 'success');
    this._closeModal(document.getElementById('modalDetail'));
    this._refreshCurrentView();
  }

  /**
   * Toggle the favourite state of a resource.
   * @param {string} resourceId
   * @param {boolean} currentState
   */
  async toggleFavorite(resourceId, currentState) {
    const { data, error } = await window.db.toggleFavorite(resourceId, currentState);
    if (error) {
      this._toast('Favoriet bijwerken mislukt.', 'error');
      return;
    }

    // Update any visible star icons for this resource
    document.querySelectorAll(`[data-resource-id="${resourceId}"] .btn-favorite`).forEach((btn) => {
      btn.classList.toggle('is-favorite', !currentState);
    });

    const detailFavBtn = document.getElementById('btnDetailFavorite');
    if (detailFavBtn && detailFavBtn.dataset.resourceId === resourceId) {
      detailFavBtn.classList.toggle('is-favorite', !currentState);
    }

    this._toast(
      !currentState ? 'Toegevoegd aan favorieten!' : 'Verwijderd uit favorieten.',
      'success'
    );
  }

  // ===========================================================================
  // AUTO-CATEGORISATION & DETECTION
  // ===========================================================================

  /**
   * Score each cached category against the resource text and return the best
   * matching category, or null when no match reaches a minimum score of 1.
   * @param {Object} resource - { title, description, url, transcript }
   * @returns {Object|null}
   */
  autoCategorize(resource) {
    const text = [
      resource.title,
      resource.description,
      resource.url,
      resource.transcript
    ].filter(Boolean).join(' ').toLowerCase();

    if (!text) return null;

    let bestCategory = null;
    let bestScore = 0;

    for (const category of this.categories) {
      const rules = category.auto_rules;
      if (!Array.isArray(rules) || rules.length === 0) continue;

      let score = 0;
      for (const keyword of rules) {
        if (text.includes(keyword.toLowerCase())) {
          score++;
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestCategory = category;
      }
    }

    return bestScore >= 1 ? bestCategory : null;
  }

  /**
   * Detect the resource type from a URL.
   * @param {string} url
   * @returns {string}
   */
  autoDetectType(url) {
    if (!url) return 'bookmark';

    const lower = url.toLowerCase();

    if (lower.includes('youtube.com') || lower.includes('youtu.be')) return 'video';
    if (lower.includes('vimeo.com')) return 'video';
    if (lower.includes('github.com')) {
      return lower.includes('/blob/') || lower.includes('/gist') ? 'snippet' : 'tool';
    }
    if (lower.includes('medium.com') || lower.includes('dev.to') || lower.includes('blog')) {
      return 'article';
    }

    return 'bookmark';
  }

  /**
   * Simple keyword-based difficulty detection.
   * @param {string} text
   * @returns {string|null}
   */
  autoDetectDifficulty(text) {
    if (!text) return null;

    const lower = text.toLowerCase();

    const levels = [
      { key: 'expert', words: ['expert', 'research', 'paper', 'thesis', 'academic'] },
      { key: 'advanced', words: ['advanced', 'complex', 'architecture', 'deep dive', 'in-depth'] },
      { key: 'intermediate', words: ['intermediate', 'practical', 'tips', 'workflow', 'hands-on'] },
      { key: 'beginner', words: ['beginner', 'intro', 'basics', 'start', 'getting started', 'eerste stappen'] }
    ];

    for (const level of levels) {
      for (const word of level.words) {
        if (lower.includes(word)) return level.key;
      }
    }

    return null;
  }

  // ===========================================================================
  // URL PROCESSING
  // ===========================================================================

  /**
   * Analyse a URL: detect type, fetch metadata (title, thumbnail, etc.).
   * @param {string} url
   * @returns {Promise<Object>}
   */
  async processUrl(url) {
    if (!url) return {};

    const type = this.autoDetectType(url);
    const result = { type, url };

    try {
      if (type === 'video' && (url.includes('youtube.com') || url.includes('youtu.be'))) {
        const videoId = this.extractYouTubeId(url);
        if (videoId) {
          result.video_id = videoId;
          result.video_platform = 'youtube';

          const info = await this.fetchYouTubeInfo(videoId);
          if (info) {
            result.title = info.title || '';
            result.description = '';
            result.thumbnail_url = info.thumbnail_url || '';
            result.video_channel = info.author_name || '';
          }
        }
      } else {
        // For non-YouTube URLs we just use the URL as a fallback title
        result.title = url;
      }
    } catch (err) {
      console.warn('ResourceManager: URL verwerken mislukt', err);
      result.title = result.title || url;
    }

    return result;
  }

  /**
   * Extract a YouTube video ID from various URL formats.
   * Supports: watch?v=, youtu.be/, /embed/, /shorts/
   * @param {string} url
   * @returns {string|null}
   */
  extractYouTubeId(url) {
    if (!url) return null;

    const patterns = [
      /[?&]v=([a-zA-Z0-9_-]{11})/,
      /youtu\.be\/([a-zA-Z0-9_-]{11})/,
      /\/embed\/([a-zA-Z0-9_-]{11})/,
      /\/shorts\/([a-zA-Z0-9_-]{11})/
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match && match[1]) return match[1];
    }

    return null;
  }

  /**
   * Fetch video metadata via YouTube's oEmbed endpoint.
   * @param {string} videoId
   * @returns {Promise<Object|null>}
   */
  async fetchYouTubeInfo(videoId) {
    try {
      const oembedUrl = window.APP_CONFIG.YOUTUBE_OEMBED_URL
        + '?url=https://youtube.com/watch?v=' + encodeURIComponent(videoId)
        + '&format=json';

      const response = await fetch(oembedUrl);
      if (!response.ok) return null;

      const data = await response.json();
      return {
        title: data.title || null,
        author_name: data.author_name || null,
        thumbnail_url: data.thumbnail_url || null
      };
    } catch (err) {
      console.warn('ResourceManager: YouTube info ophalen mislukt', err);
      return null;
    }
  }

  // ===========================================================================
  // VIEW LOADING
  // ===========================================================================

  /**
   * Load the dashboard view: stats, recent items, favourites.
   */
  async loadDashboard() {
    const userId = this._userId();
    if (!userId) return;

    try {
      // Stats
      const counts = await window.db.getResourceCounts(userId);
      this._setText('statVideos', counts.video);
      this._setText('statArticles', counts.article);
      this._setText('statTools', counts.tool);
      this._setText('statPrompts', counts.prompt);
      this._setText('statFolders', counts.folders);
      this._setText('statFavorites', counts.favorites);
      this._setText('videoCount', counts.video);
      this._setText('inboxCount', counts.inbox);

      // Recent resources (8)
      const { data: recent } = await window.db.getResources({
        userId,
        sortBy: 'created_at',
        sortDir: 'desc',
        limit: 8
      });
      this._renderGrid('recentResources', recent, 'Nog geen items. Klik op <strong>+ Toevoegen</strong> om te beginnen.');

      // Favourites
      const { data: favorites } = await window.db.getResources({
        userId,
        isFavorite: true,
        sortBy: 'updated_at',
        sortDir: 'desc',
        limit: 8
      });
      this._renderList('favoriteResources', favorites, 'Markeer items als favoriet om ze hier te zien.');
    } catch (err) {
      console.error('ResourceManager: dashboard laden mislukt', err);
    }
  }

  /**
   * Load the video view.
   */
  async loadVideoView() {
    const userId = this._userId();
    if (!userId) return;

    const { data, count } = await window.db.getResources({
      userId,
      type: 'video',
      sortBy: 'created_at',
      sortDir: 'desc',
      limit: 100
    });

    this._setText('videoCount', count || (data ? data.length : 0));
    this._renderGrid('videoGrid', data, 'Nog geen video\'s. Voeg je eerste video toe.');
  }

  /**
   * Load the articles + bookmarks view.
   */
  async loadArticleView() {
    const userId = this._userId();
    if (!userId) return;

    // Get articles
    const { data: articles } = await window.db.getResources({
      userId,
      type: 'article',
      limit: 100
    });

    // Get bookmarks
    const { data: bookmarks } = await window.db.getResources({
      userId,
      type: 'bookmark',
      limit: 100
    });

    const combined = [...(articles || []), ...(bookmarks || [])];
    combined.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    this._renderGrid('articleGrid', combined, 'Nog geen artikelen. Voeg je eerste artikel of bookmark toe.');
  }

  /**
   * Load the AI tools view.
   */
  async loadToolView() {
    const userId = this._userId();
    if (!userId) return;

    const { data } = await window.db.getResources({
      userId,
      type: 'tool',
      limit: 100
    });

    this._renderGrid('toolGrid', data, 'Nog geen AI tools. Voeg je eerste tool toe.');
  }

  /**
   * Load the prompts view.
   */
  async loadPromptView() {
    const userId = this._userId();
    if (!userId) return;

    const { data } = await window.db.getResources({
      userId,
      type: 'prompt',
      limit: 100
    });

    this._renderGrid('promptGrid', data, 'Nog geen prompts. Voeg je eerste prompt toe.');
  }

  /**
   * Load the notes view.
   */
  async loadNoteView() {
    const userId = this._userId();
    if (!userId) return;

    const { data } = await window.db.getResources({
      userId,
      type: 'note',
      limit: 100
    });

    this._renderGrid('noteGrid', data, 'Nog geen notities. Voeg je eerste notitie toe.');
  }

  /**
   * Load the folders view and render the folder tree.
   */
  async loadFolderView() {
    await this.loadFolders();
    this._renderFolderTree();

    // If a folder is selected, show its contents
    if (this._selectedFolderId) {
      await this._loadFolderContents(this._selectedFolderId);
    }
  }

  /**
   * Load the favourites view.
   */
  async loadFavoriteView() {
    const userId = this._userId();
    if (!userId) return;

    const { data } = await window.db.getResources({
      userId,
      isFavorite: true,
      sortBy: 'updated_at',
      sortDir: 'desc',
      limit: 100
    });

    this._renderGrid('favoritesGrid', data, 'Nog geen favorieten. Markeer items met een ster.');
  }

  /**
   * Load the inbox view (unsorted resources).
   */
  async loadInboxView() {
    const userId = this._userId();
    if (!userId) return;

    const { data, count } = await window.db.getResources({
      userId,
      status: 'inbox',
      sortBy: 'created_at',
      sortDir: 'desc',
      limit: 100
    });

    this._setText('inboxCount', count || (data ? data.length : 0));
    this._renderGrid('inboxGrid', data, 'Inbox is leeg. Goed bezig!');
  }

  /**
   * Load the collections view.
   */
  async loadCollectionView() {
    const userId = this._userId();
    if (!userId) return;

    const { data } = await window.db.getCollections(userId);
    const container = document.getElementById('collectionGrid');
    if (!container) return;

    if (!data || data.length === 0) {
      container.innerHTML = this._emptyState('Nog geen collecties. Maak je eerste collectie aan.');
      this._refreshIcons();
      return;
    }

    container.innerHTML = data.map((collection) => `
      <div class="collection-card glass-card" data-collection-id="${collection.id}">
        <div class="collection-card-header">
          <i data-lucide="layout-grid"></i>
          <h3>${this._escape(collection.name)}</h3>
        </div>
        <p class="collection-card-desc">${this._escape(collection.description || '')}</p>
        <div class="collection-card-meta">
          <span>${this._formatDate(collection.created_at)}</span>
        </div>
      </div>
    `).join('');

    this._refreshIcons();
  }

  // ===========================================================================
  // FOLDER CRUD
  // ===========================================================================

  /**
   * Open the folder creation modal.
   */
  openFolderModal() {
    const modal = document.getElementById('modalFolder');
    const form = document.getElementById('folderForm');
    if (form) form.reset();

    this._folderColor = '#25D366';

    // Reset colour-swatch active state
    const swatches = document.querySelectorAll('#modalFolder .color-swatch');
    swatches.forEach((s) => s.classList.remove('active'));
    const first = document.querySelector('#modalFolder .color-swatch[data-color="#25D366"]');
    if (first) first.classList.add('active');

    this._openModal(modal);
  }

  /**
   * Save a new folder.
   */
  async saveFolder() {
    const userId = this._userId();
    if (!userId) return;

    const name = this._getVal('folderName');
    if (!name) {
      this._toast('Vul een mapnaam in.', 'warning');
      return;
    }

    const parentId = this._getVal('folderParent') || null;
    const description = this._getVal('folderDescription') || null;

    const { data, error } = await window.db.createFolder({
      user_id: userId,
      name,
      parent_id: parentId,
      color: this._folderColor,
      description
    });

    if (error) {
      this._toast('Map aanmaken mislukt.', 'error');
      return;
    }

    this._closeModal(document.getElementById('modalFolder'));
    this._toast('Map aangemaakt!', 'success');
    await this.loadFolders();
    this._refreshCurrentView();
  }

  // ===========================================================================
  // DETAIL VIEW
  // ===========================================================================

  /**
   * Open the full resource detail modal.
   * @param {string} resourceId
   */
  async openDetail(resourceId) {
    const { data: resource, error } = await window.db.getResource(resourceId);
    if (error || !resource) {
      this._toast('Kan resource niet laden.', 'error');
      return;
    }

    const modal = document.getElementById('modalDetail');
    const titleEl = document.getElementById('detailTitle');
    const bodyEl = document.getElementById('detailBody');

    if (!modal || !bodyEl) return;

    const typeConfig = window.APP_CONFIG.RESOURCE_TYPES[resource.type] || {};
    const categoryName = resource.categories?.name || 'Geen categorie';
    const categoryColor = resource.categories?.color || '#a1a1aa';
    const folderName = resource.folders?.name || '';
    const tags = (resource.resource_tags || [])
      .map((rt) => rt.tags?.name)
      .filter(Boolean);

    // Title
    if (titleEl) {
      titleEl.innerHTML = `
        <span class="detail-type-badge" style="background:${typeConfig.color || '#a1a1aa'}">
          ${typeConfig.label || resource.type}
        </span>
        ${this._escape(resource.title)}
      `;
    }

    // Body content
    let html = '';

    // Video embed
    if (resource.type === 'video' && resource.video_id && resource.video_platform === 'youtube') {
      const embedUrl = (window.APP_CONFIG.YOUTUBE_NOCOOKIE_URL || 'https://www.youtube-nocookie.com/embed/')
        + encodeURIComponent(resource.video_id);
      html += `
        <div class="detail-video">
          <div class="video-embed-wrapper">
            <iframe src="${embedUrl}" frameborder="0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowfullscreen></iframe>
          </div>
        </div>
      `;
    } else if (resource.thumbnail_url) {
      html += `<img class="detail-thumbnail" src="${this._escape(resource.thumbnail_url)}" alt="">`;
    }

    // Meta row
    html += `
      <div class="detail-meta">
        <span class="detail-category" style="border-color:${categoryColor}">
          <span class="dot" style="background:${categoryColor}"></span>
          ${this._escape(categoryName)}
        </span>
        ${folderName ? `<span class="detail-folder"><i data-lucide="folder" class="icon-sm"></i> ${this._escape(folderName)}</span>` : ''}
        ${resource.ai_difficulty ? `<span class="detail-difficulty badge-${resource.ai_difficulty}">${resource.ai_difficulty}</span>` : ''}
        <span class="detail-date"><i data-lucide="calendar" class="icon-sm"></i> ${this._formatDate(resource.created_at)}</span>
      </div>
    `;

    // Description
    if (resource.description) {
      html += `
        <div class="detail-section">
          <h3>Beschrijving</h3>
          <p>${this._escape(resource.description)}</p>
        </div>
      `;
    }

    // Transcript with toggle
    if (resource.transcript) {
      html += `
        <div class="detail-section">
          <h3>
            <i data-lucide="subtitles" class="icon-sm"></i> Transcript
            <button class="btn btn-sm btn-outline btn-toggle-transcript" onclick="this.closest('.detail-section').querySelector('.transcript-text').classList.toggle('collapsed')">
              Toon/Verberg
            </button>
          </h3>
          <div class="transcript-text collapsed">${this._escape(resource.transcript)}</div>
        </div>
      `;
    }

    // Summaries
    const summaries = [
      { key: 'summary_short', label: 'Korte samenvatting' },
      { key: 'summary_medium', label: 'Samenvatting' },
      { key: 'summary_detailed', label: 'Uitgebreide samenvatting' },
      { key: 'summary_keypoints', label: 'Kernpunten' }
    ];

    for (const s of summaries) {
      if (resource[s.key]) {
        html += `
          <div class="detail-section">
            <h3><i data-lucide="sparkles" class="icon-sm"></i> ${s.label}</h3>
            <div class="summary-block">${this._escape(resource[s.key])}</div>
          </div>
        `;
      }
    }

    // Personal notes
    if (resource.personal_notes) {
      html += `
        <div class="detail-section">
          <h3><i data-lucide="pencil" class="icon-sm"></i> Persoonlijke notities</h3>
          <p>${this._escape(resource.personal_notes)}</p>
        </div>
      `;
    }

    // Tags
    if (tags.length) {
      html += `
        <div class="detail-section">
          <h3><i data-lucide="tags" class="icon-sm"></i> Tags</h3>
          <div class="detail-tags">
            ${tags.map((t) => `<span class="tag">${this._escape(t)}</span>`).join('')}
          </div>
        </div>
      `;
    }

    // Rating
    if (resource.rating) {
      const stars = Array.from({ length: 5 }, (_, i) =>
        `<i data-lucide="${i < resource.rating ? 'star' : 'star'}" class="icon-sm ${i < resource.rating ? 'star-filled' : 'star-empty'}"></i>`
      ).join('');
      html += `
        <div class="detail-section">
          <h3>Beoordeling</h3>
          <div class="detail-rating">${stars}</div>
        </div>
      `;
    }

    // Link to original
    if (resource.url) {
      html += `
        <div class="detail-section">
          <a href="${this._escape(resource.url)}" target="_blank" rel="noopener noreferrer" class="btn btn-outline">
            <i data-lucide="external-link"></i> Origineel openen
          </a>
        </div>
      `;
    }

    bodyEl.innerHTML = html;

    // Bind detail action buttons
    const favBtn = document.getElementById('btnDetailFavorite');
    if (favBtn) {
      favBtn.dataset.resourceId = resource.id;
      favBtn.classList.toggle('is-favorite', !!resource.is_favorite);
      favBtn.onclick = () => this.toggleFavorite(resource.id, !!resource.is_favorite);
    }

    const editBtn = document.getElementById('btnDetailEdit');
    if (editBtn) {
      editBtn.onclick = () => {
        this._closeModal(modal);
        this.openEditModal(resource.id);
      };
    }

    const deleteBtn = document.getElementById('btnDetailDelete');
    if (deleteBtn) {
      deleteBtn.onclick = () => this.deleteResource(resource.id);
    }

    this._openModal(modal);
  }

  // ===========================================================================
  // EVENT LISTENER SETUP
  // ===========================================================================

  /**
   * Bind all button event listeners.
   * @private
   */
  _bindEventListeners() {
    // Add-resource buttons
    this._on('btnAddResource', 'click', () => this.openAddModal());
    this._on('btnAddVideo', 'click', () => this.openAddModal('video'));
    this._on('btnAddArticle', 'click', () => this.openAddModal('article'));
    this._on('btnAddTool', 'click', () => this.openAddModal('tool'));
    this._on('btnAddPrompt', 'click', () => this.openAddModal('prompt'));
    this._on('btnAddNote', 'click', () => this.openAddModal('note'));
    this._on('btnAddFolder', 'click', () => this.openFolderModal());
    this._on('btnAddCollection', 'click', () => this.openAddModal('collection'));

    // Save buttons
    this._on('btnSaveResource', 'click', (e) => {
      e.preventDefault();
      this.saveResource();
    });
    this._on('btnSaveFolder', 'click', (e) => {
      e.preventDefault();
      this.saveFolder();
    });

    // Fetch URL button
    this._on('btnFetchUrl', 'click', async () => {
      const urlInput = document.getElementById('resourceUrl');
      if (!urlInput || !urlInput.value.trim()) {
        this._toast('Vul eerst een URL in.', 'warning');
        return;
      }
      await this._handleFetchUrl(urlInput.value.trim());
    });

    // Auto-sort inbox
    this._on('btnAutoSort', 'click', () => this._autoSortInbox());

    // Resource type change toggles video fields
    const typeSelect = document.getElementById('resourceType');
    if (typeSelect) {
      typeSelect.addEventListener('change', () => {
        this._toggleVideoFields(typeSelect.value);
      });
    }

    // Colour swatches in folder modal
    document.querySelectorAll('#modalFolder .color-swatch').forEach((swatch) => {
      swatch.addEventListener('click', (e) => {
        e.preventDefault();
        document.querySelectorAll('#modalFolder .color-swatch').forEach((s) => s.classList.remove('active'));
        swatch.classList.add('active');
        this._folderColor = swatch.dataset.color;
      });
    });

    // Event delegation on resource grids
    this._bindGridDelegation();
  }

  /**
   * Bind quick-add tiles on the dashboard.
   * @private
   */
  _bindQuickAddTiles() {
    document.querySelectorAll('.quick-add-tile').forEach((tile) => {
      tile.addEventListener('click', () => {
        const type = tile.dataset.type || 'bookmark';
        this.openAddModal(type);
      });
    });
  }

  /**
   * Listen for the custom 'view-changed' event dispatched by the navigation
   * system to load the appropriate view data.
   * @private
   */
  _bindViewChangedEvent() {
    document.addEventListener('view-changed', (e) => {
      const view = e.detail?.view;
      if (!view) return;
      this._loadViewData(view);
    });
  }

  /**
   * Close modals when clicking overlay or close button.
   * @private
   */
  _bindModalDismiss() {
    document.querySelectorAll('.modal').forEach((modal) => {
      // Overlay click
      const overlay = modal.querySelector('.modal-overlay');
      if (overlay) {
        overlay.addEventListener('click', () => this._closeModal(modal));
      }
      // Close buttons
      modal.querySelectorAll('.modal-close').forEach((btn) => {
        btn.addEventListener('click', () => this._closeModal(modal));
      });
    });

    // ESC key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const openModal = document.querySelector('.modal.active, .modal.open');
        if (openModal) this._closeModal(openModal);
      }
    });
  }

  /**
   * Event delegation for card clicks, favourite, edit and delete buttons
   * inside any resource grid/list.
   * @private
   */
  _bindGridDelegation() {
    const grids = [
      'recentResources', 'favoriteResources', 'videoGrid', 'articleGrid',
      'toolGrid', 'promptGrid', 'noteGrid', 'favoritesGrid', 'inboxGrid',
      'folderContents'
    ];

    for (const gridId of grids) {
      const el = document.getElementById(gridId);
      if (!el) continue;

      el.addEventListener('click', (e) => {
        const target = e.target.closest('[data-action]');
        if (target) {
          e.stopPropagation();
          const action = target.dataset.action;
          const card = target.closest('[data-resource-id]');
          const resourceId = card?.dataset.resourceId;
          if (!resourceId) return;

          switch (action) {
            case 'favorite':
              const isFav = target.classList.contains('is-favorite');
              this.toggleFavorite(resourceId, isFav);
              break;
            case 'edit':
              this.openEditModal(resourceId);
              break;
            case 'delete':
              this.deleteResource(resourceId);
              break;
          }
          return;
        }

        // Card click -> open detail
        const card = e.target.closest('[data-resource-id]');
        if (card) {
          this.openDetail(card.dataset.resourceId);
        }
      });
    }
  }

  // ===========================================================================
  // PRIVATE HELPERS
  // ===========================================================================

  /** Current user id shorthand. */
  _userId() {
    return window.authManager?.currentUser?.id || null;
  }

  /** Show a toast via the UI module. */
  _toast(message, type = 'info') {
    if (window.ui?.showToast) {
      window.ui.showToast(message, type);
    } else {
      console.log(`[Toast/${type}] ${message}`);
    }
  }

  /** Open a modal (add `.active` or `.open` class). */
  _openModal(modal) {
    if (!modal) return;
    modal.classList.add('active');
    modal.classList.add('open');
    document.body.classList.add('modal-open');
    this._refreshIcons();
  }

  /** Close a modal. */
  _closeModal(modal) {
    if (!modal) return;
    modal.classList.remove('active');
    modal.classList.remove('open');
    // Only remove body class if no other modals are open
    if (!document.querySelector('.modal.active, .modal.open')) {
      document.body.classList.remove('modal-open');
    }
  }

  /** Safe get value from an input by id. */
  _getVal(id) {
    const el = document.getElementById(id);
    return el ? el.value.trim() : '';
  }

  /** Safe set value on an input by id. */
  _setVal(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = value;
  }

  /** Safe set textContent on an element by id. */
  _setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  /** Bind click listener by element id. */
  _on(id, event, handler) {
    const el = document.getElementById(id);
    if (el) el.addEventListener(event, handler);
  }

  /** Escape HTML to prevent XSS. */
  _escape(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /** Format a date string to Dutch locale. */
  _formatDate(dateStr) {
    if (!dateStr) return '';
    try {
      return new Date(dateStr).toLocaleDateString('nl-NL', {
        day: 'numeric',
        month: 'short',
        year: 'numeric'
      });
    } catch {
      return dateStr;
    }
  }

  /** Trigger Lucide icon refresh. */
  _refreshIcons() {
    if (window.lucide?.createIcons) {
      window.lucide.createIcons();
    }
  }

  /** Show/hide the video-specific form fields. */
  _toggleVideoFields(type) {
    const container = document.getElementById('videoFields');
    if (container) {
      container.classList.toggle('hidden', type !== 'video');
    }
  }

  /** Clear the URL preview area. */
  _clearUrlPreview() {
    const preview = document.getElementById('urlPreview');
    if (preview) {
      preview.innerHTML = '';
      preview.classList.add('hidden');
    }
  }

  /**
   * Populate a category dropdown with cached categories.
   * @param {string} selectId
   * @private
   */
  _populateCategoryDropdown(selectId) {
    const select = document.getElementById(selectId);
    if (!select) return;

    // Keep the first (default) option
    const firstOption = select.querySelector('option');
    select.innerHTML = '';
    if (firstOption) select.appendChild(firstOption);

    for (const cat of this.categories) {
      const opt = document.createElement('option');
      opt.value = cat.id;
      opt.textContent = cat.name;
      select.appendChild(opt);
    }
  }

  /**
   * Populate a folder dropdown with cached folders.
   * @param {string} selectId
   * @private
   */
  _populateFolderDropdown(selectId) {
    const select = document.getElementById(selectId);
    if (!select) return;

    const firstOption = select.querySelector('option');
    select.innerHTML = '';
    if (firstOption) select.appendChild(firstOption);

    for (const folder of this.folders) {
      const opt = document.createElement('option');
      opt.value = folder.id;
      opt.textContent = folder.name;
      select.appendChild(opt);
    }
  }

  /**
   * Render the folder tree in the folder view sidebar.
   * @private
   */
  _renderFolderTree() {
    const container = document.getElementById('folderTree');
    if (!container) return;

    if (!this.folders || this.folders.length === 0) {
      container.innerHTML = this._emptyState('Nog geen mappen. Maak je eerste map aan.');
      this._refreshIcons();
      return;
    }

    // Build a simple nested structure
    const map = {};
    const roots = [];
    for (const f of this.folders) {
      map[f.id] = { ...f, children: [] };
    }
    for (const f of this.folders) {
      if (f.parent_id && map[f.parent_id]) {
        map[f.parent_id].children.push(map[f.id]);
      } else {
        roots.push(map[f.id]);
      }
    }

    const renderNode = (node, depth = 0) => {
      const isSelected = node.id === this._selectedFolderId;
      let html = `
        <button class="folder-tree-item ${isSelected ? 'active' : ''}"
                data-folder-id="${node.id}"
                style="padding-left:${12 + depth * 16}px">
          <i data-lucide="folder" class="icon-sm" style="color:${node.color || '#25D366'}"></i>
          <span>${this._escape(node.name)}</span>
        </button>
      `;
      if (node.children.length) {
        for (const child of node.children) {
          html += renderNode(child, depth + 1);
        }
      }
      return html;
    };

    container.innerHTML = roots.map((r) => renderNode(r)).join('');

    // Bind folder selection
    container.querySelectorAll('.folder-tree-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        this._selectedFolderId = btn.dataset.folderId;
        // Highlight active
        container.querySelectorAll('.folder-tree-item').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this._loadFolderContents(this._selectedFolderId);
      });
    });

    this._refreshIcons();
  }

  /**
   * Load and render resources inside a specific folder.
   * @param {string} folderId
   * @private
   */
  async _loadFolderContents(folderId) {
    const userId = this._userId();
    if (!userId) return;

    const { data } = await window.db.getResources({
      userId,
      folderId,
      limit: 100
    });

    this._renderGrid('folderContents', data, 'Deze map is leeg.');
  }

  /**
   * Filter a view by category (navigate to the appropriate view and filter).
   * @param {string} categoryId
   * @private
   */
  async _filterByCategory(categoryId) {
    const userId = this._userId();
    if (!userId) return;

    const { data } = await window.db.getResources({
      userId,
      categoryId,
      limit: 100
    });

    // For now render in the first available grid (dashboard recent)
    this._renderGrid('recentResources', data, 'Geen items in deze categorie.');
  }

  /**
   * Handle the "Ophalen" (Fetch) button: process URL and fill form fields.
   * @param {string} url
   * @private
   */
  async _handleFetchUrl(url) {
    const preview = document.getElementById('urlPreview');
    if (preview) {
      preview.innerHTML = '<span class="loading-text">Bezig met ophalen...</span>';
      preview.classList.remove('hidden');
    }

    const info = await this.processUrl(url);

    if (info.title) this._setVal('resourceTitle', info.title);
    if (info.type) this._setVal('resourceType', info.type);
    if (info.type) this._toggleVideoFields(info.type);

    // Show preview
    if (preview) {
      if (info.thumbnail_url || info.title) {
        let previewHtml = '';
        if (info.thumbnail_url) {
          previewHtml += `<img src="${this._escape(info.thumbnail_url)}" alt="" class="url-preview-thumb">`;
        }
        previewHtml += `<div class="url-preview-info">`;
        if (info.title) previewHtml += `<strong>${this._escape(info.title)}</strong>`;
        if (info.video_channel) previewHtml += `<span>${this._escape(info.video_channel)}</span>`;
        previewHtml += `<span class="badge">${info.type || 'bookmark'}</span>`;
        previewHtml += `</div>`;
        preview.innerHTML = previewHtml;
      } else {
        preview.innerHTML = '<span>Geen preview beschikbaar.</span>';
      }
    }
  }

  /**
   * Auto-categorise all items currently in the inbox.
   * @private
   */
  async _autoSortInbox() {
    const userId = this._userId();
    if (!userId) return;

    this._toast('Bezig met automatisch categoriseren...', 'info');

    const { data: inboxItems } = await window.db.getResources({
      userId,
      status: 'inbox',
      limit: 200
    });

    if (!inboxItems || inboxItems.length === 0) {
      this._toast('Inbox is al leeg!', 'info');
      return;
    }

    let sorted = 0;

    for (const item of inboxItems) {
      const category = this.autoCategorize(item);
      if (category) {
        await window.db.updateResource(item.id, {
          category_id: category.id,
          status: 'sorted'
        });
        sorted++;
      }
    }

    this._toast(`${sorted} van ${inboxItems.length} items gecategoriseerd.`, 'success');
    this._refreshCurrentView();
  }

  /**
   * Sync tags: parse comma-separated tag names, create if needed, link to resource.
   * @param {string} resourceId
   * @param {string} tagsRaw - Comma-separated tag names.
   * @param {string} userId
   * @private
   */
  async _syncTags(resourceId, tagsRaw, userId) {
    const tagNames = tagsRaw
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    for (const name of tagNames) {
      try {
        const { data: tag } = await window.db.createTag({
          user_id: userId,
          name
        });
        if (tag?.id) {
          await window.db.addTagToResource(resourceId, tag.id);
        }
      } catch (err) {
        console.warn('ResourceManager: tag sync mislukt voor', name, err);
      }
    }
  }

  /**
   * Determine the currently active view and reload its data.
   * @private
   */
  _refreshCurrentView() {
    const activeView = document.querySelector('.view.active');
    if (!activeView) return;

    const viewId = activeView.id;
    const viewMap = {
      viewDashboard: 'dashboard',
      viewVideos: 'videos',
      viewArticles: 'articles',
      viewTools: 'tools',
      viewPrompts: 'prompts',
      viewNotes: 'notes',
      viewFolders: 'folders',
      viewFavorites: 'favorites',
      viewInbox: 'inbox',
      viewCollections: 'collections'
    };

    const view = viewMap[viewId];
    if (view) this._loadViewData(view);
  }

  /**
   * Route a view name to the appropriate loader.
   * @param {string} view
   * @private
   */
  _loadViewData(view) {
    switch (view) {
      case 'dashboard': this.loadDashboard(); break;
      case 'videos': this.loadVideoView(); break;
      case 'articles': this.loadArticleView(); break;
      case 'tools': this.loadToolView(); break;
      case 'prompts': this.loadPromptView(); break;
      case 'notes': this.loadNoteView(); break;
      case 'folders': this.loadFolderView(); break;
      case 'favorites': this.loadFavoriteView(); break;
      case 'inbox': this.loadInboxView(); break;
      case 'collections': this.loadCollectionView(); break;
    }
  }

  // ---------------------------------------------------------------------------
  // Rendering helpers
  // ---------------------------------------------------------------------------

  /**
   * Render a grid of resource cards into a container.
   * @param {string} containerId
   * @param {Array|null} resources
   * @param {string} emptyMessage
   * @private
   */
  _renderGrid(containerId, resources, emptyMessage) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (!resources || resources.length === 0) {
      container.innerHTML = this._emptyState(emptyMessage);
      this._refreshIcons();
      return;
    }

    // Delegate to ui.renderResourceCard if available, otherwise use built-in
    if (window.ui?.renderResourceCard) {
      container.innerHTML = resources.map((r) => window.ui.renderResourceCard(r)).join('');
    } else {
      container.innerHTML = resources.map((r) => this._renderCard(r)).join('');
    }

    this._refreshIcons();
  }

  /**
   * Render a list of resources (compact style) into a container.
   * @param {string} containerId
   * @param {Array|null} resources
   * @param {string} emptyMessage
   * @private
   */
  _renderList(containerId, resources, emptyMessage) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (!resources || resources.length === 0) {
      container.innerHTML = this._emptyState(emptyMessage);
      this._refreshIcons();
      return;
    }

    if (window.ui?.renderResourceListItem) {
      container.innerHTML = resources.map((r) => window.ui.renderResourceListItem(r)).join('');
    } else {
      container.innerHTML = resources.map((r) => this._renderListItem(r)).join('');
    }

    this._refreshIcons();
  }

  /**
   * Built-in resource card renderer (fallback when ui module is unavailable).
   * @param {Object} resource
   * @returns {string}
   * @private
   */
  _renderCard(resource) {
    const typeConfig = window.APP_CONFIG.RESOURCE_TYPES[resource.type] || {};
    const categoryName = resource.categories?.name || '';
    const categoryColor = resource.categories?.color || '#a1a1aa';
    const isFav = resource.is_favorite;

    const thumbnailHtml = resource.thumbnail_url
      ? `<div class="card-thumbnail"><img src="${this._escape(resource.thumbnail_url)}" alt="" loading="lazy"></div>`
      : '';

    return `
      <div class="resource-card glass-card" data-resource-id="${resource.id}">
        ${thumbnailHtml}
        <div class="card-body">
          <div class="card-header">
            <span class="card-type" style="color:${typeConfig.color || '#a1a1aa'}">
              <i data-lucide="${typeConfig.icon || 'file'}"></i>
              ${typeConfig.label || resource.type}
            </span>
            <button class="btn-icon btn-favorite ${isFav ? 'is-favorite' : ''}" data-action="favorite" title="Favoriet">
              <i data-lucide="star"></i>
            </button>
          </div>
          <h3 class="card-title">${this._escape(resource.title)}</h3>
          ${resource.description ? `<p class="card-desc">${this._escape(resource.description).substring(0, 120)}${resource.description.length > 120 ? '...' : ''}</p>` : ''}
          <div class="card-footer">
            ${categoryName ? `<span class="card-category" style="border-color:${categoryColor}"><span class="dot" style="background:${categoryColor}"></span>${this._escape(categoryName)}</span>` : ''}
            <span class="card-date">${this._formatDate(resource.created_at)}</span>
          </div>
        </div>
        <div class="card-actions">
          <button class="btn-icon-sm" data-action="edit" title="Bewerken"><i data-lucide="pencil"></i></button>
          <button class="btn-icon-sm" data-action="delete" title="Verwijderen"><i data-lucide="trash-2"></i></button>
        </div>
      </div>
    `;
  }

  /**
   * Built-in compact list item renderer (fallback).
   * @param {Object} resource
   * @returns {string}
   * @private
   */
  _renderListItem(resource) {
    const typeConfig = window.APP_CONFIG.RESOURCE_TYPES[resource.type] || {};
    const isFav = resource.is_favorite;

    return `
      <div class="resource-list-item" data-resource-id="${resource.id}">
        <span class="list-icon" style="color:${typeConfig.color || '#a1a1aa'}">
          <i data-lucide="${typeConfig.icon || 'file'}"></i>
        </span>
        <span class="list-title">${this._escape(resource.title)}</span>
        <span class="list-date">${this._formatDate(resource.created_at)}</span>
        <button class="btn-icon-sm btn-favorite ${isFav ? 'is-favorite' : ''}" data-action="favorite" title="Favoriet">
          <i data-lucide="star"></i>
        </button>
      </div>
    `;
  }

  /**
   * Empty state placeholder HTML.
   * @param {string} message
   * @returns {string}
   * @private
   */
  _emptyState(message) {
    return `
      <div class="empty-state">
        <i data-lucide="inbox" class="empty-icon"></i>
        <p>${message}</p>
      </div>
    `;
  }
}

// =============================================================================
// Expose & Initialise
// =============================================================================
window.ResourceManager = ResourceManager;
window.resourceManager = new ResourceManager();
