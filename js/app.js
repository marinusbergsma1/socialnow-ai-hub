/**
 * SocialNow AI Hub - Main Application
 * Initializes all modules and manages the Quick Drop Zone
 */

class App {
  constructor() {
    this.isInitialized = false;
    this.dropQueue = [];
  }

  /**
   * Initialize the application
   */
  async init() {
    console.log('🚀 SocialNow AI Hub initializing...');

    // Initialize auth first (handles login/logout flow)
    if (window.authManager) {
      await window.authManager.init();
    }

    // Initialize UI
    if (window.ui) {
      window.ui.init();
    }

    // Set up Quick Drop Zone
    this.initQuickDrop();

    // Set up global paste handler
    this.initGlobalPaste();

    // Set up global drag & drop
    this.initGlobalDragDrop();

    console.log('✅ SocialNow AI Hub ready');
  }

  /**
   * Called after successful login
   */
  async onLogin() {
    if (this.isInitialized) return;
    this.isInitialized = true;

    console.log('👤 User logged in, loading data...');

    // Initialize all modules in parallel
    const initPromises = [];

    if (window.resourceManager) {
      initPromises.push(window.resourceManager.init());
    }
    if (window.videoManager) {
      initPromises.push(window.videoManager.init());
    }
    if (window.chatManager) {
      initPromises.push(window.chatManager.init());
    }

    await Promise.allSettled(initPromises);

    // Load dashboard data
    if (window.resourceManager) {
      await window.resourceManager.loadDashboard();
    }

    // Refresh all icons
    if (window.ui) {
      window.ui.refreshIcons();
    }

    console.log('✅ All modules loaded');
  }

  /**
   * Called on logout
   */
  onLogout() {
    this.isInitialized = false;
    this.dropQueue = [];
  }

  // =============================================
  // QUICK DROP ZONE
  // =============================================

  initQuickDrop() {
    const toggle = document.getElementById('quickDropToggle');
    const panel = document.getElementById('quickDropPanel');
    const zone = document.getElementById('quickDropZone');
    const input = document.getElementById('quickDropInput');
    const submitBtn = document.getElementById('quickDropSubmit');
    const processAllBtn = document.getElementById('quickDropProcessAll');

    if (!toggle || !panel) return;

    // Toggle panel
    toggle.addEventListener('click', () => {
      panel.classList.toggle('active');
      toggle.classList.toggle('active');
      if (panel.classList.contains('active')) {
        input?.focus();
      }
    });

    // Close panel on outside click
    document.addEventListener('click', (e) => {
      const quickDrop = document.getElementById('quickDrop');
      if (quickDrop && !quickDrop.contains(e.target) && panel.classList.contains('active')) {
        panel.classList.remove('active');
        toggle.classList.remove('active');
      }
    });

    // Submit button
    if (submitBtn) {
      submitBtn.addEventListener('click', () => this.handleQuickDropSubmit());
    }

    // Enter to submit (Shift+Enter for newline)
    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this.handleQuickDropSubmit();
        }
      });
    }

    // Drag & drop on the zone
    if (zone) {
      zone.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        zone.classList.add('drag-over');
      });

      zone.addEventListener('dragleave', (e) => {
        e.preventDefault();
        zone.classList.remove('drag-over');
      });

      zone.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        zone.classList.remove('drag-over');
        this.handleDrop(e);
      });
    }

    // Process all button
    if (processAllBtn) {
      processAllBtn.addEventListener('click', () => this.processAllDropItems());
    }
  }

  /**
   * Handle Quick Drop submit (from input or paste)
   */
  async handleQuickDropSubmit() {
    const input = document.getElementById('quickDropInput');
    if (!input) return;

    const text = input.value.trim();
    if (!text) return;

    input.value = '';

    // Check if it contains URLs (one per line or space-separated)
    const urls = this.extractUrls(text);

    if (urls.length > 0) {
      // Process each URL
      for (const url of urls) {
        await this.addToDropQueue(url, 'url');
      }
      // Also check for remaining text that isn't a URL
      const remainingText = text;
      urls.forEach(url => remainingText.replace(url, ''));
      const cleaned = remainingText.replace(/https?:\/\/\S+/g, '').trim();
      if (cleaned.length > 10) {
        await this.addToDropQueue(cleaned, 'text');
      }
    } else {
      // It's a text note
      await this.addToDropQueue(text, 'text');
    }

    if (window.ui) {
      window.ui.showToast('Item(s) toegevoegd aan wachtrij', 'success');
    }
  }

  /**
   * Extract URLs from text
   */
  extractUrls(text) {
    const urlRegex = /https?:\/\/[^\s<>\"']+/g;
    return text.match(urlRegex) || [];
  }

  /**
   * Add item to the drop queue
   */
  async addToDropQueue(content, contentType) {
    const userId = window.authManager?.currentUser?.id;
    if (!userId) return;

    const item = {
      id: Date.now() + '_' + Math.random().toString(36).substr(2, 6),
      content,
      contentType,
      status: 'pending', // pending, processing, done, error
      result: null,
      timestamp: new Date()
    };

    this.dropQueue.push(item);
    this.renderDropQueue();

    // Auto-process immediately
    await this.processDropItem(item);
  }

  /**
   * Process a single drop queue item
   */
  async processDropItem(item) {
    const userId = window.authManager?.currentUser?.id;
    if (!userId) return;

    item.status = 'processing';
    this.renderDropQueue();

    try {
      let resource;

      if (item.contentType === 'url') {
        // Process URL
        const type = this.detectUrlType(item.content);
        let title = item.content;
        let description = '';
        let thumbnailUrl = '';
        let videoId = null;
        let videoPlatform = null;
        let videoChannel = '';

        // Try to fetch info for YouTube URLs
        if (type === 'video' && window.videoManager) {
          const ytId = window.videoManager.extractYouTubeId(item.content);
          if (ytId) {
            videoId = ytId;
            videoPlatform = 'youtube';
            thumbnailUrl = `https://img.youtube.com/vi/${ytId}/mqdefault.jpg`;
            try {
              const info = await window.videoManager.fetchVideoInfo(item.content);
              if (info) {
                title = info.title || title;
                videoChannel = info.channel || '';
                thumbnailUrl = info.thumbnailUrl || thumbnailUrl;
              }
            } catch (err) {
              console.warn('Could not fetch YouTube info:', err);
            }
          }
        }

        // Try to get a readable title from the URL
        if (title === item.content) {
          try {
            const urlObj = new URL(item.content);
            const pathParts = urlObj.pathname.split('/').filter(Boolean);
            if (pathParts.length > 0) {
              title = decodeURIComponent(pathParts[pathParts.length - 1])
                .replace(/[-_]/g, ' ')
                .replace(/\.\w+$/, '');
              // Capitalize first letter
              title = title.charAt(0).toUpperCase() + title.slice(1);
            } else {
              title = urlObj.hostname.replace('www.', '');
            }
          } catch {
            // Keep URL as title
          }
        }

        resource = {
          user_id: userId,
          type: type,
          status: 'inbox',
          title: title,
          description: description,
          url: item.content,
          thumbnail_url: thumbnailUrl,
          video_id: videoId,
          video_platform: videoPlatform,
          video_channel: videoChannel
        };
      } else {
        // Text note
        const firstLine = item.content.split('\n')[0].substring(0, 100);
        resource = {
          user_id: userId,
          type: 'note',
          status: 'inbox',
          title: firstLine || 'Snelle notitie',
          description: item.content.length > 100 ? item.content : '',
          notes: item.content
        };
      }

      // Auto-categorize
      if (window.resourceManager) {
        const category = window.resourceManager.autoCategorize(resource);
        if (category) {
          resource.category_id = category.id;
        }

        // Auto-detect difficulty
        const difficulty = window.resourceManager.autoDetectDifficulty(
          `${resource.title} ${resource.description || ''} ${resource.notes || ''}`
        );
        if (difficulty) {
          resource.ai_difficulty = difficulty;
        }
      }

      // Save to database
      const { data, error } = await window.db.createResource(resource);

      if (error) {
        throw new Error(error.message || 'Database error');
      }

      item.status = 'done';
      item.result = data;

      // Log activity
      if (window.db) {
        window.db.logActivity(userId, 'quick_drop', resource.type, data?.id, {
          source: 'quick_drop',
          content_type: item.contentType
        });
      }

    } catch (err) {
      console.error('Error processing drop item:', err);
      item.status = 'error';
      item.result = err.message;
    }

    this.renderDropQueue();
    this.updateDropBadge();
  }

  /**
   * Process all pending items in the queue
   */
  async processAllDropItems() {
    const pending = this.dropQueue.filter(i => i.status === 'pending' || i.status === 'error');
    for (const item of pending) {
      await this.processDropItem(item);
    }

    // Refresh current view
    if (window.resourceManager && window.ui) {
      const view = window.ui.currentView;
      if (view === 'dashboard') {
        await window.resourceManager.loadDashboard();
      } else if (view === 'inbox') {
        await window.resourceManager.loadInboxView();
      }
    }

    if (window.ui) {
      window.ui.showToast(`${pending.length} items verwerkt!`, 'success');
    }
  }

  /**
   * Detect resource type from URL
   */
  detectUrlType(url) {
    try {
      const hostname = new URL(url).hostname.toLowerCase();
      const path = new URL(url).pathname.toLowerCase();

      if (hostname.includes('youtube.com') || hostname.includes('youtu.be')) return 'video';
      if (hostname.includes('vimeo.com')) return 'video';
      if (hostname.includes('github.com')) {
        if (path.includes('/blob/') || path.includes('/tree/')) return 'snippet';
        return 'tool';
      }
      if (hostname.includes('medium.com') || hostname.includes('dev.to') ||
          hostname.includes('blog') || hostname.includes('hashnode')) return 'article';
      if (hostname.includes('udemy.com') || hostname.includes('coursera.org') ||
          hostname.includes('skillshare.com')) return 'course';
      if (hostname.includes('figma.com') || hostname.includes('canva.com') ||
          hostname.includes('dribbble.com')) return 'tool';

      return 'bookmark';
    } catch {
      return 'bookmark';
    }
  }

  /**
   * Render the drop queue UI
   */
  renderDropQueue() {
    const container = document.getElementById('quickDropItems');
    const queueSection = document.getElementById('quickDropQueue');
    if (!container || !queueSection) return;

    if (this.dropQueue.length === 0) {
      queueSection.classList.add('hidden');
      return;
    }

    queueSection.classList.remove('hidden');

    const statusIcons = {
      pending: 'clock',
      processing: 'loader',
      done: 'check-circle',
      error: 'alert-circle'
    };

    const statusColors = {
      pending: '#a1a1aa',
      processing: '#FFD700',
      done: '#25D366',
      error: '#FF6B6B'
    };

    container.innerHTML = this.dropQueue.map(item => {
      const icon = statusIcons[item.status];
      const color = statusColors[item.status];
      const displayContent = item.contentType === 'url'
        ? this.truncateUrl(item.content)
        : item.content.substring(0, 60) + (item.content.length > 60 ? '...' : '');
      const typeLabel = item.contentType === 'url' ? 'Link' : 'Notitie';

      return `
        <div class="quick-drop-item ${item.status}">
          <div class="quick-drop-item-icon" style="color: ${color}">
            <i data-lucide="${icon}"></i>
          </div>
          <div class="quick-drop-item-content">
            <span class="quick-drop-item-type">${typeLabel}</span>
            <span class="quick-drop-item-text" title="${this.escapeHtml(item.content)}">${this.escapeHtml(displayContent)}</span>
          </div>
          <button class="btn-icon-sm quick-drop-item-remove" data-drop-id="${item.id}" title="Verwijderen">
            <i data-lucide="x"></i>
          </button>
        </div>
      `;
    }).join('');

    // Bind remove buttons
    container.querySelectorAll('.quick-drop-item-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.dataset.dropId;
        this.dropQueue = this.dropQueue.filter(i => i.id !== id);
        this.renderDropQueue();
        this.updateDropBadge();
      });
    });

    // Refresh icons
    if (window.lucide) {
      window.lucide.createIcons();
    }
  }

  /**
   * Update the badge count on the drop toggle
   */
  updateDropBadge() {
    const badge = document.getElementById('quickDropBadge');
    if (!badge) return;

    const pendingCount = this.dropQueue.filter(i => i.status === 'pending').length;
    if (pendingCount > 0) {
      badge.textContent = pendingCount;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  }

  // =============================================
  // GLOBAL PASTE HANDLER
  // =============================================

  initGlobalPaste() {
    document.addEventListener('paste', (e) => {
      // Don't intercept if user is typing in a form field
      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable)) {
        // But do intercept if it's the quick drop input
        if (activeEl.id !== 'quickDropInput') return;
      }

      // Only if app is visible and user is logged in
      if (!this.isInitialized) return;

      const text = e.clipboardData?.getData('text/plain');
      if (!text) return;

      const urls = this.extractUrls(text);
      if (urls.length > 0) {
        // Open quick drop panel and add items
        const panel = document.getElementById('quickDropPanel');
        const toggle = document.getElementById('quickDropToggle');
        if (panel && !panel.classList.contains('active')) {
          panel.classList.add('active');
          toggle?.classList.add('active');
        }

        urls.forEach(url => this.addToDropQueue(url, 'url'));

        if (window.ui) {
          window.ui.showToast(`${urls.length} link(s) gedetecteerd en wordt verwerkt`, 'info');
        }
      }
    });
  }

  // =============================================
  // GLOBAL DRAG & DROP
  // =============================================

  initGlobalDragDrop() {
    const overlay = document.getElementById('globalDropOverlay');
    if (!overlay) return;

    let dragCounter = 0;

    document.addEventListener('dragenter', (e) => {
      if (!this.isInitialized) return;
      e.preventDefault();
      dragCounter++;
      if (dragCounter === 1) {
        overlay.classList.remove('hidden');
      }
    });

    document.addEventListener('dragleave', (e) => {
      e.preventDefault();
      dragCounter--;
      if (dragCounter <= 0) {
        dragCounter = 0;
        overlay.classList.add('hidden');
      }
    });

    document.addEventListener('dragover', (e) => {
      if (!this.isInitialized) return;
      e.preventDefault();
    });

    document.addEventListener('drop', (e) => {
      e.preventDefault();
      dragCounter = 0;
      overlay.classList.add('hidden');
      this.handleDrop(e);
    });
  }

  /**
   * Handle dropped content
   */
  handleDrop(e) {
    if (!this.isInitialized) return;

    // Check for dropped text/URLs
    const text = e.dataTransfer?.getData('text/plain');
    const html = e.dataTransfer?.getData('text/html');
    const uriList = e.dataTransfer?.getData('text/uri-list');

    // Open quick drop panel
    const panel = document.getElementById('quickDropPanel');
    const toggle = document.getElementById('quickDropToggle');
    if (panel && !panel.classList.contains('active')) {
      panel.classList.add('active');
      toggle?.classList.add('active');
    }

    let processed = false;

    // URI list (dragged links)
    if (uriList) {
      const urls = uriList.split('\n').filter(u => u.startsWith('http'));
      urls.forEach(url => this.addToDropQueue(url.trim(), 'url'));
      processed = true;
    }

    // Plain text with URLs
    if (!processed && text) {
      const urls = this.extractUrls(text);
      if (urls.length > 0) {
        urls.forEach(url => this.addToDropQueue(url, 'url'));
        processed = true;
      } else if (text.trim().length > 0) {
        this.addToDropQueue(text.trim(), 'text');
        processed = true;
      }
    }

    // HTML with links
    if (!processed && html) {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const links = doc.querySelectorAll('a[href]');
      if (links.length > 0) {
        links.forEach(link => {
          const href = link.getAttribute('href');
          if (href && href.startsWith('http')) {
            this.addToDropQueue(href, 'url');
          }
        });
        processed = true;
      }
    }

    if (processed && window.ui) {
      window.ui.showToast('Content gedetecteerd en wordt verwerkt!', 'success');
    }
  }

  // =============================================
  // UTILITIES
  // =============================================

  truncateUrl(url) {
    try {
      const u = new URL(url);
      const path = u.pathname.length > 30
        ? u.pathname.substring(0, 30) + '...'
        : u.pathname;
      return u.hostname.replace('www.', '') + path;
    } catch {
      return url.substring(0, 50) + '...';
    }
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// =============================================
// INITIALIZE APP
// =============================================
window.App = App;
window.app = new App();

// Start when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => window.app.init());
} else {
  window.app.init();
}
