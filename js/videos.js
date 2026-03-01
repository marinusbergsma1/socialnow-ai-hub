/**
 * SocialNow AI Hub - Video Management Module
 * Handles YouTube video processing, embedding, and transcript display.
 * Depends on: window.APP_CONFIG (config.js), window.ui (ui.js), window.db (database.js)
 */

class VideoManager {
  constructor() {
    /**
     * Regex patterns for all supported YouTube URL formats.
     * Order matters: more specific patterns are tested first.
     */
    this.youtubePatterns = [
      // youtube.com/watch?v=ID (with optional extra params)
      /(?:https?:\/\/)?(?:www\.)?youtube\.com\/watch\?.*v=([a-zA-Z0-9_-]{11})/,
      // youtu.be/ID
      /(?:https?:\/\/)?youtu\.be\/([a-zA-Z0-9_-]{11})/,
      // youtube.com/embed/ID
      /(?:https?:\/\/)?(?:www\.)?youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
      // youtube.com/shorts/ID
      /(?:https?:\/\/)?(?:www\.)?youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
      // youtube.com/v/ID (legacy)
      /(?:https?:\/\/)?(?:www\.)?youtube\.com\/v\/([a-zA-Z0-9_-]{11})/
    ];

    /** Cache fetched video info to avoid repeat oEmbed calls. */
    this._cache = new Map();
  }

  // ===========================================================================
  // INITIALIZATION
  // ===========================================================================

  /**
   * Set up all video-specific event listeners.
   * Called once after the DOM is ready.
   */
  init() {
    this.setupFormListeners();
  }

  // ===========================================================================
  // YOUTUBE URL HANDLING
  // ===========================================================================

  /**
   * Extract a YouTube video ID from any known URL format.
   * @param {string} url
   * @returns {string|null} 11-character video ID or null
   */
  extractYouTubeId(url) {
    if (!url || typeof url !== 'string') return null;

    const trimmed = url.trim();
    for (const pattern of this.youtubePatterns) {
      const match = trimmed.match(pattern);
      if (match && match[1]) return match[1];
    }

    return null;
  }

  /**
   * Fetch video metadata via YouTube oEmbed and generate thumbnail URLs.
   * @param {string} url - Any YouTube URL
   * @returns {Promise<Object|null>} Video info object or null
   */
  async fetchVideoInfo(url) {
    const videoId = this.extractYouTubeId(url);
    if (!videoId) return null;

    // Return cached result if available
    if (this._cache.has(videoId)) {
      return this._cache.get(videoId);
    }

    try {
      const oembedBase = window.APP_CONFIG?.YOUTUBE_OEMBED_URL
        || 'https://www.youtube.com/oembed';
      const oembedUrl = `${oembedBase}?url=https://www.youtube.com/watch?v=${videoId}&format=json`;

      const response = await fetch(oembedUrl);
      if (!response.ok) {
        console.warn('VideoManager: oEmbed request failed', response.status);
        return null;
      }

      const data = await response.json();

      const info = {
        videoId,
        title: data.title || '',
        channel: data.author_name || '',
        thumbnailUrl: data.thumbnail_url || `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
        thumbnails: {
          mqdefault: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
          hqdefault: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
          maxresdefault: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`
        },
        platform: 'youtube'
      };

      this._cache.set(videoId, info);
      return info;
    } catch (error) {
      console.error('VideoManager: fetchVideoInfo failed', error);
      return null;
    }
  }

  // ===========================================================================
  // RENDERING - EMBED
  // ===========================================================================

  /**
   * Return an HTML string for a responsive, privacy-enhanced YouTube embed.
   * Uses youtube-nocookie.com to avoid tracking cookies.
   * @param {string} videoId
   * @param {string} [title='']
   * @returns {string} HTML string
   */
  renderVideoEmbed(videoId, title = '') {
    const nocookieBase = window.APP_CONFIG?.YOUTUBE_NOCOOKIE_URL
      || 'https://www.youtube-nocookie.com/embed/';
    const safeTitle = this._escapeHtml(title);

    return `
      <div class="video-embed" style="position:relative;width:100%;padding-top:56.25%;overflow:hidden;border-radius:var(--radius-lg);background:var(--bg-surface);">
        <iframe
          src="${nocookieBase}${videoId}"
          title="${safeTitle}"
          frameborder="0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowfullscreen
          loading="lazy"
          style="position:absolute;top:0;left:0;width:100%;height:100%;border:0;"
        ></iframe>
      </div>`;
  }

  // ===========================================================================
  // RENDERING - CARD
  // ===========================================================================

  /**
   * Render a compact video card for grid views.
   * @param {Object} resource - Resource row from the database
   * @returns {string} HTML string
   */
  renderVideoCard(resource) {
    const meta = resource.metadata || {};
    const videoId = meta.videoId || this.extractYouTubeId(resource.url) || '';
    const thumbnail = meta.thumbnailUrl
      || (videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : '');
    const channel = meta.channel || '';
    const duration = meta.duration ? this.formatDuration(meta.duration) : '';
    const title = this._escapeHtml(resource.title || 'Zonder titel');
    const category = resource.categories;
    const difficulty = resource.ai_difficulty;

    // Category badge
    let categoryBadge = '';
    if (category) {
      categoryBadge = `
        <span class="card-badge" style="background:${category.color || 'var(--green)'}20;color:${category.color || 'var(--green)'}">
          ${this._escapeHtml(category.name)}
        </span>`;
    }

    // AI difficulty badge
    let difficultyBadge = '';
    if (difficulty) {
      const level = window.APP_CONFIG?.AI_DIFFICULTY_LEVELS?.[difficulty];
      if (level) {
        difficultyBadge = `
          <span class="card-badge" style="background:${level.color}20;color:${level.color}">
            ${level.label}
          </span>`;
      }
    }

    return `
      <div class="resource-card video-card" data-resource-id="${resource.id}">
        <div class="video-card-thumbnail">
          ${thumbnail
            ? `<img src="${thumbnail}" alt="${title}" loading="lazy">`
            : `<div class="video-card-placeholder"><i data-lucide="play-circle"></i></div>`}
          <div class="video-card-play-overlay">
            <i data-lucide="play"></i>
          </div>
          ${duration
            ? `<span class="video-card-duration">${duration}</span>`
            : ''}
        </div>
        <div class="video-card-body">
          ${channel
            ? `<span class="video-card-channel">${this._escapeHtml(channel)}</span>`
            : ''}
          <h3 class="video-card-title" title="${title}">${title}</h3>
          <div class="video-card-meta">
            ${categoryBadge}
            ${difficultyBadge}
          </div>
        </div>
        <div class="video-card-actions">
          <button class="btn-icon-sm" data-action="favorite" title="Favoriet">
            <i data-lucide="${resource.is_favorite ? 'star' : 'star'}"
               class="${resource.is_favorite ? 'text-yellow' : ''}"></i>
          </button>
          <button class="btn-icon-sm" data-action="view" title="Bekijken">
            <i data-lucide="eye"></i>
          </button>
          <button class="btn-icon-sm" data-action="edit" title="Bewerken">
            <i data-lucide="pencil"></i>
          </button>
        </div>
      </div>`;
  }

  // ===========================================================================
  // RENDERING - DETAIL VIEW
  // ===========================================================================

  /**
   * Render the full video detail view shown inside the detail modal.
   * Includes embed, metadata, tabs for summary/transcript/keypoints/notes,
   * tags, and related videos placeholder.
   * @param {Object} resource - Full resource record with relations
   * @returns {string} HTML string
   */
  renderVideoDetail(resource) {
    const meta = resource.metadata || {};
    const videoId = meta.videoId || this.extractYouTubeId(resource.url) || '';
    const channel = meta.channel || '';
    const publishedDate = resource.created_at
      ? new Date(resource.created_at).toLocaleDateString('nl-NL', {
          year: 'numeric', month: 'long', day: 'numeric'
        })
      : '';
    const description = resource.description || '';
    const summary = meta.summary || {};
    const transcript = meta.transcript || '';
    const keypoints = meta.keypoints || [];
    const notes = resource.notes || '';
    const tags = resource.resource_tags
      ? resource.resource_tags.map((rt) => rt.tags).filter(Boolean)
      : [];

    // Build embed
    const embedHtml = videoId
      ? this.renderVideoEmbed(videoId, resource.title)
      : '';

    // Build summary tabs content
    const summaryShort = summary.short || 'Geen korte samenvatting beschikbaar.';
    const summaryMedium = summary.medium || 'Geen samenvatting beschikbaar.';
    const summaryDetailed = summary.detailed || 'Geen uitgebreide samenvatting beschikbaar.';

    // Build keypoints list
    let keypointsHtml = '<p class="text-muted">Geen kernpunten beschikbaar.</p>';
    if (keypoints.length > 0) {
      keypointsHtml = `
        <ul class="keypoints-list">
          ${keypoints.map((kp) => `<li>${this._escapeHtml(kp)}</li>`).join('')}
        </ul>`;
    }

    // Build transcript block
    let transcriptHtml = '<p class="text-muted">Geen transcript beschikbaar.</p>';
    if (transcript) {
      transcriptHtml = `
        <div class="transcript-scroll">
          <pre class="transcript-text">${this._escapeHtml(transcript)}</pre>
        </div>`;
    }

    // Build tags
    let tagsHtml = '';
    if (tags.length > 0) {
      tagsHtml = `
        <div class="detail-tags">
          ${tags.map((t) => `
            <span class="tag-chip" style="background:${t.color || 'var(--green)'}20;color:${t.color || 'var(--green)'}">
              ${this._escapeHtml(t.name)}
            </span>
          `).join('')}
        </div>`;
    }

    return `
      <div class="video-detail">
        <!-- Player -->
        ${embedHtml}

        <!-- Meta -->
        <div class="video-detail-header">
          <h2 class="video-detail-title">${this._escapeHtml(resource.title || '')}</h2>
          <div class="video-detail-meta">
            ${channel
              ? `<span class="video-detail-channel"><i data-lucide="user"></i> ${this._escapeHtml(channel)}</span>`
              : ''}
            ${publishedDate
              ? `<span class="video-detail-date"><i data-lucide="calendar"></i> ${publishedDate}</span>`
              : ''}
            ${resource.url
              ? `<a href="${resource.url}" target="_blank" rel="noopener noreferrer" class="video-detail-link">
                   <i data-lucide="external-link"></i> Bekijk op YouTube
                 </a>`
              : ''}
          </div>
        </div>

        <!-- Description -->
        ${description
          ? `<div class="video-detail-description">
               <p>${this._escapeHtml(description)}</p>
             </div>`
          : ''}

        <!-- Tabs -->
        <div class="video-detail-tabs">
          <div class="detail-tab-nav">
            <button class="detail-tab active" data-detail-tab="summary">
              <i data-lucide="sparkles"></i> Samenvatting
            </button>
            <button class="detail-tab" data-detail-tab="transcript">
              <i data-lucide="subtitles"></i> Transcript
            </button>
            <button class="detail-tab" data-detail-tab="keypoints">
              <i data-lucide="list-checks"></i> Kernpunten
            </button>
            <button class="detail-tab" data-detail-tab="notes">
              <i data-lucide="pencil"></i> Notities
            </button>
          </div>

          <!-- Tab: Samenvatting -->
          <div class="detail-tab-content active" data-detail-panel="summary">
            <div class="summary-toggle">
              <button class="summary-tab active" data-summary="short">Kort</button>
              <button class="summary-tab" data-summary="medium">Medium</button>
              <button class="summary-tab" data-summary="detailed">Uitgebreid</button>
            </div>
            <div class="summary-panels">
              <div class="summary-panel active" data-summary-panel="short">
                <p>${this._escapeHtml(summaryShort)}</p>
              </div>
              <div class="summary-panel" data-summary-panel="medium">
                <p>${this._escapeHtml(summaryMedium)}</p>
              </div>
              <div class="summary-panel" data-summary-panel="detailed">
                <p>${this._escapeHtml(summaryDetailed)}</p>
              </div>
            </div>
          </div>

          <!-- Tab: Transcript -->
          <div class="detail-tab-content" data-detail-panel="transcript">
            ${transcriptHtml}
          </div>

          <!-- Tab: Kernpunten -->
          <div class="detail-tab-content" data-detail-panel="keypoints">
            ${keypointsHtml}
          </div>

          <!-- Tab: Notities -->
          <div class="detail-tab-content" data-detail-panel="notes">
            <textarea
              class="detail-notes-editor"
              data-resource-id="${resource.id}"
              placeholder="Schrijf je eigen notities en inzichten..."
              rows="6"
            >${this._escapeHtml(notes)}</textarea>
            <button class="btn btn-sm btn-primary detail-save-notes" data-resource-id="${resource.id}">
              <i data-lucide="save"></i> Notities opslaan
            </button>
          </div>
        </div>

        <!-- Tags -->
        ${tagsHtml}

        <!-- Related Videos -->
        <div class="video-detail-related">
          <h3 class="section-title"><i data-lucide="layout-grid"></i> Gerelateerde video's</h3>
          <div class="related-videos-grid" data-category-id="${resource.category_id || ''}" data-resource-id="${resource.id}">
            <p class="text-muted">Gerelateerde video's worden hier geladen...</p>
          </div>
        </div>
      </div>`;
  }

  // ===========================================================================
  // RENDERING - GRID
  // ===========================================================================

  /**
   * Render a grid of video cards, or an empty state when there are none.
   * @param {Array} videos - Array of resource objects with type=video
   * @returns {string} HTML string
   */
  renderVideoGrid(videos) {
    if (!videos || videos.length === 0) {
      return `
        <div class="empty-state">
          <i data-lucide="play-circle" class="empty-icon"></i>
          <h3>Nog geen video's</h3>
          <p>Plak een YouTube URL om te beginnen. De video wordt automatisch gecategoriseerd en samengevat.</p>
        </div>`;
    }

    const cards = videos.map((video) => this.renderVideoCard(video)).join('');
    return `<div class="video-grid">${cards}</div>`;
  }

  // ===========================================================================
  // RENDERING - URL PREVIEW
  // ===========================================================================

  /**
   * Render a compact preview card after a YouTube URL has been fetched.
   * Shown inside the resource form's #urlPreview container.
   * @param {Object} videoInfo - Object returned by fetchVideoInfo()
   * @returns {string} HTML string
   */
  renderUrlPreview(videoInfo) {
    if (!videoInfo) return '';

    const thumbnail = videoInfo.thumbnails?.hqdefault || videoInfo.thumbnailUrl || '';
    const title = this._escapeHtml(videoInfo.title || '');
    const channel = this._escapeHtml(videoInfo.channel || '');

    return `
      <div class="url-preview-card">
        <div class="url-preview-thumb">
          ${thumbnail
            ? `<img src="${thumbnail}" alt="${title}" loading="lazy">`
            : `<div class="url-preview-placeholder"><i data-lucide="play-circle"></i></div>`}
        </div>
        <div class="url-preview-info">
          <h4 class="url-preview-title">${title}</h4>
          ${channel ? `<span class="url-preview-channel">${channel}</span>` : ''}
          <span class="url-preview-badge">
            <i data-lucide="play-circle"></i> YouTube
          </span>
        </div>
      </div>`;
  }

  // ===========================================================================
  // DURATION FORMATTING
  // ===========================================================================

  /**
   * Convert a duration in seconds to a readable string.
   * @param {number} seconds
   * @returns {string} e.g. "5:30" or "1:02:15"
   */
  formatDuration(seconds) {
    if (!seconds || isNaN(seconds) || seconds < 0) return '0:00';

    const totalSeconds = Math.floor(seconds);
    const hrs = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;

    if (hrs > 0) {
      return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }

    return `${mins}:${String(secs).padStart(2, '0')}`;
  }

  // ===========================================================================
  // FORM & EVENT LISTENERS
  // ===========================================================================

  /**
   * Wire up listeners for the resource form that are video-specific:
   * - Show/hide video fields when resource type changes
   * - Auto-fetch YouTube info when a URL is pasted or entered
   * - Summary sub-tab switching inside the form
   * - Detail-view tab switching (delegated)
   * - Save-notes button inside detail view (delegated)
   */
  setupFormListeners() {
    // --- Resource type toggle ---
    const typeSelect = document.getElementById('resourceType');
    const videoFields = document.getElementById('videoFields');

    if (typeSelect && videoFields) {
      typeSelect.addEventListener('change', () => {
        if (typeSelect.value === 'video') {
          videoFields.classList.remove('hidden');
        } else {
          videoFields.classList.add('hidden');
        }
      });
    }

    // --- Auto-fetch YouTube URL ---
    const urlInput = document.getElementById('resourceUrl');
    const btnFetch = document.getElementById('btnFetchUrl');

    if (urlInput) {
      // Debounced handler for paste/input events
      let fetchTimeout = null;

      const handleUrlInput = () => {
        clearTimeout(fetchTimeout);
        fetchTimeout = setTimeout(() => {
          const url = urlInput.value.trim();
          if (url && this.extractYouTubeId(url)) {
            this._autoFetchAndFill(url);
          }
        }, 400);
      };

      urlInput.addEventListener('paste', () => {
        // Paste fires before value updates; use a microtask.
        setTimeout(handleUrlInput, 50);
      });

      urlInput.addEventListener('input', handleUrlInput);
    }

    if (btnFetch) {
      btnFetch.addEventListener('click', () => {
        const url = urlInput?.value?.trim();
        if (url) {
          this._autoFetchAndFill(url);
        }
      });
    }

    // --- Summary tabs inside form ---
    document.addEventListener('click', (e) => {
      const summaryTab = e.target.closest('.summary-tab');
      if (!summaryTab) return;

      const container = summaryTab.closest('.summary-toggle, .summary-tabs');
      if (!container) return;

      // Deactivate siblings
      container.querySelectorAll('.summary-tab').forEach((t) => t.classList.remove('active'));
      summaryTab.classList.add('active');

      const level = summaryTab.dataset.summary;
      if (!level) return;

      // Toggle panels if in detail view
      const panelContainer = summaryTab.closest('.detail-tab-content')
        || summaryTab.closest('.summary-container');
      if (panelContainer) {
        panelContainer.querySelectorAll('.summary-panel').forEach((p) => {
          p.classList.toggle('active', p.dataset.summaryPanel === level);
        });
      }
    });

    // --- Detail view tab switching (delegated) ---
    document.addEventListener('click', (e) => {
      const tab = e.target.closest('.detail-tab');
      if (!tab) return;

      const nav = tab.closest('.detail-tab-nav');
      const wrapper = tab.closest('.video-detail-tabs');
      if (!nav || !wrapper) return;

      const targetPanel = tab.dataset.detailTab;

      // Switch active tab
      nav.querySelectorAll('.detail-tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');

      // Switch active panel
      wrapper.querySelectorAll('.detail-tab-content').forEach((p) => {
        p.classList.toggle('active', p.dataset.detailPanel === targetPanel);
      });
    });

    // --- Save notes inside detail view (delegated) ---
    document.addEventListener('click', async (e) => {
      const btn = e.target.closest('.detail-save-notes');
      if (!btn) return;

      const resourceId = btn.dataset.resourceId;
      const textarea = document.querySelector(
        `.detail-notes-editor[data-resource-id="${resourceId}"]`
      );
      if (!textarea || !resourceId) return;

      const notes = textarea.value;

      try {
        const { error } = await window.db.updateResource(resourceId, { notes });
        if (error) {
          window.ui?.showToast?.('Fout bij opslaan van notities', 'error');
          console.error('VideoManager: save notes failed', error);
        } else {
          window.ui?.showToast?.('Notities opgeslagen', 'success');
        }
      } catch (err) {
        window.ui?.showToast?.('Fout bij opslaan van notities', 'error');
        console.error('VideoManager: save notes exception', err);
      }
    });
  }

  // ===========================================================================
  // PRIVATE HELPERS
  // ===========================================================================

  /**
   * Fetch YouTube info for a URL and auto-fill relevant form fields.
   * Also shows a URL preview card.
   * @param {string} url
   * @private
   */
  async _autoFetchAndFill(url) {
    const preview = document.getElementById('urlPreview');
    const titleInput = document.getElementById('resourceTitle');
    const typeSelect = document.getElementById('resourceType');
    const videoFields = document.getElementById('videoFields');

    // Show loading state
    if (preview) {
      preview.classList.remove('hidden');
      preview.innerHTML = `
        <div class="url-preview-loading">
          <i data-lucide="loader-2" class="spin"></i>
          <span>Video ophalen...</span>
        </div>`;
      window.ui?.refreshIcons?.();
    }

    const info = await this.fetchVideoInfo(url);

    if (!info) {
      if (preview) {
        preview.innerHTML = '';
        preview.classList.add('hidden');
      }
      return;
    }

    // Fill form fields
    if (titleInput && !titleInput.value.trim()) {
      titleInput.value = info.title;
    }

    if (typeSelect) {
      typeSelect.value = 'video';
      typeSelect.dispatchEvent(new Event('change'));
    }

    if (videoFields) {
      videoFields.classList.remove('hidden');
    }

    // Show preview
    if (preview) {
      preview.innerHTML = this.renderUrlPreview(info);
      preview.classList.remove('hidden');
      window.ui?.refreshIcons?.();
    }
  }

  /**
   * Escape HTML entities to prevent XSS in rendered output.
   * @param {string} str
   * @returns {string}
   * @private
   */
  _escapeHtml(str) {
    if (!str) return '';
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return String(str).replace(/[&<>"']/g, (c) => map[c]);
  }
}

// ---------------------------------------------------------------------------
// Expose globally
// ---------------------------------------------------------------------------
window.VideoManager = VideoManager;
window.videoManager = new VideoManager();
