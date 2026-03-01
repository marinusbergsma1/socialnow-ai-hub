/**
 * SocialNow AI Hub - UI Module
 * Manages navigation, modals, toasts, view switching, and UI rendering.
 */
class UI {

  constructor() {
    this.currentView = 'dashboard';
    this.viewMode = 'grid';
    this._searchDebounceTimer = null;
    this._toastCount = 0;
  }

  // ---------------------------------------------------------------------------
  // Initialization
  // ---------------------------------------------------------------------------

  init() {
    this._setupNavigation();
    this._setupModalCloseButtons();
    this._setupKeyboardShortcuts();
    this._setupSidebarToggle();
    this._setupViewToggles();
    this.initSearchModal();
    this.refreshIcons();
  }

  // ---------------------------------------------------------------------------
  // Private Setup Helpers
  // ---------------------------------------------------------------------------

  /**
   * Delegate clicks on sidebar .nav-item buttons to switch views.
   */
  _setupNavigation() {
    const nav = document.querySelector('.sidebar-nav');
    if (!nav) return;

    nav.addEventListener('click', (e) => {
      const navItem = e.target.closest('.nav-item');
      if (!navItem) return;

      const viewName = navItem.dataset.view;
      if (viewName) {
        this.switchView(viewName);

        // Close sidebar on mobile after navigation
        const sidebar = document.getElementById('sidebar');
        const backdrop = document.querySelector('.sidebar-backdrop');
        if (sidebar) sidebar.classList.remove('open');
        if (backdrop) backdrop.classList.remove('active');
      }
    });
  }

  /**
   * Set up close buttons for all modals (both X buttons and overlay clicks).
   * Uses event delegation on the document body.
   */
  _setupModalCloseButtons() {
    document.addEventListener('click', (e) => {
      // Close button (.modal-close)
      const closeBtn = e.target.closest('.modal-close');
      if (closeBtn) {
        const modal = closeBtn.closest('.modal');
        if (modal) {
          this.closeModal(modal.id);
        }
        return;
      }

      // Overlay click
      const overlay = e.target.closest('.modal-overlay');
      if (overlay) {
        const modal = overlay.closest('.modal');
        if (modal) {
          this.closeModal(modal.id);
        }
      }
    });
  }

  /**
   * Register keyboard shortcuts.
   *   Ctrl+K  => open search modal
   *   Escape  => close active modal
   */
  _setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      // Ctrl+K (or Cmd+K on Mac) for search
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        this.openModal('modalSearch');
        const searchInput = document.getElementById('searchModalInput');
        if (searchInput) {
          searchInput.value = '';
          searchInput.focus();
        }
        return;
      }

      // Escape to close modals
      if (e.key === 'Escape') {
        this.closeAllModals();
      }
    });
  }

  /**
   * Mobile sidebar toggle button and backdrop.
   */
  _setupSidebarToggle() {
    const toggleBtn = document.getElementById('btnToggleSidebar');
    const sidebar = document.getElementById('sidebar');
    if (!toggleBtn || !sidebar) return;

    // Create backdrop element if it does not exist
    let backdrop = document.querySelector('.sidebar-backdrop');
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.className = 'sidebar-backdrop';
      sidebar.parentNode.insertBefore(backdrop, sidebar.nextSibling);
    }

    toggleBtn.addEventListener('click', () => {
      sidebar.classList.toggle('open');
      backdrop.classList.toggle('active');
    });

    backdrop.addEventListener('click', () => {
      sidebar.classList.remove('open');
      backdrop.classList.remove('active');
    });
  }

  /**
   * Grid / List view toggle buttons.
   */
  _setupViewToggles() {
    const gridBtn = document.getElementById('btnGridView');
    const listBtn = document.getElementById('btnListView');

    if (gridBtn) {
      gridBtn.addEventListener('click', () => {
        this.viewMode = 'grid';
        if (gridBtn) gridBtn.classList.add('active');
        if (listBtn) listBtn.classList.remove('active');
        document.dispatchEvent(new CustomEvent('viewmode-changed', { detail: { mode: 'grid' } }));
      });
    }

    if (listBtn) {
      listBtn.addEventListener('click', () => {
        this.viewMode = 'list';
        if (listBtn) listBtn.classList.add('active');
        if (gridBtn) gridBtn.classList.remove('active');
        document.dispatchEvent(new CustomEvent('viewmode-changed', { detail: { mode: 'list' } }));
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Navigation / View Switching
  // ---------------------------------------------------------------------------

  /**
   * Switch the active view.
   * @param {string} viewName - Name of the view (e.g. 'dashboard', 'videos').
   */
  switchView(viewName) {
    // Remove active state from all views and nav items
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach((n) => n.classList.remove('active'));

    // Capitalise first letter for the element ID (e.g. 'videos' => 'viewVideos')
    const viewId = 'view' + viewName.charAt(0).toUpperCase() + viewName.slice(1);
    const targetView = document.getElementById(viewId);

    if (targetView) {
      targetView.classList.add('active');
    }

    // Activate the matching nav item
    const navItem = document.querySelector(`.nav-item[data-view="${viewName}"]`);
    if (navItem) {
      navItem.classList.add('active');
    }

    this.currentView = viewName;
    this.loadViewData(viewName);
    this.refreshIcons();
  }

  /**
   * Dispatches a custom 'view-changed' event so other modules can react.
   * @param {string} viewName
   */
  async loadViewData(viewName) {
    document.dispatchEvent(new CustomEvent('view-changed', { detail: { view: viewName } }));
  }

  // ---------------------------------------------------------------------------
  // Modal Methods
  // ---------------------------------------------------------------------------

  /**
   * Open a modal by its element ID.
   * @param {string} modalId
   */
  openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;

    modal.classList.add('active');
    document.body.classList.add('modal-open');
  }

  /**
   * Close a specific modal by ID. If modalId is null/undefined, close all.
   * @param {string|null} modalId
   */
  closeModal(modalId) {
    if (!modalId) {
      this.closeAllModals();
      return;
    }

    const modal = document.getElementById(modalId);
    if (!modal) return;

    modal.classList.remove('active');

    // Only remove modal-open from body if no modals remain active
    const remaining = document.querySelectorAll('.modal.active');
    if (remaining.length === 0) {
      document.body.classList.remove('modal-open');
    }
  }

  /**
   * Close every open modal.
   */
  closeAllModals() {
    document.querySelectorAll('.modal.active').forEach((m) => {
      m.classList.remove('active');
    });
    document.body.classList.remove('modal-open');
  }

  // ---------------------------------------------------------------------------
  // Toast Notifications
  // ---------------------------------------------------------------------------

  /**
   * Show a toast notification.
   * @param {string}  message   - Text to display.
   * @param {string}  type      - 'success' | 'error' | 'info' | 'warning'
   * @param {number}  duration  - Auto-dismiss in ms (default 4000).
   */
  showToast(message, type = 'success', duration = 4000) {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const iconMap = {
      success: 'check-circle',
      error: 'alert-circle',
      info: 'info',
      warning: 'alert-triangle'
    };

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
      <i data-lucide="${iconMap[type] || 'info'}"></i>
      <span class="toast-message">${message}</span>
      <button class="toast-close btn-icon-sm" aria-label="Sluiten">
        <i data-lucide="x"></i>
      </button>
    `;

    // Close on click
    toast.querySelector('.toast-close').addEventListener('click', () => {
      this._removeToast(toast);
    });

    container.appendChild(toast);
    this.refreshIcons();

    // Enforce max 5 visible toasts
    const toasts = container.querySelectorAll('.toast');
    if (toasts.length > 5) {
      this._removeToast(toasts[0]);
    }

    // Auto-dismiss
    setTimeout(() => {
      this._removeToast(toast);
    }, duration);
  }

  /**
   * Remove a toast element with a slide-out animation.
   * @param {HTMLElement} toast
   */
  _removeToast(toast) {
    if (!toast || !toast.parentNode) return;

    toast.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';

    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 300);
  }

  // ---------------------------------------------------------------------------
  // Rendering Helpers
  // ---------------------------------------------------------------------------

  /**
   * Render a resource card (grid view).
   * @param {Object} resource
   * @returns {string} HTML string
   */
  renderResourceCard(resource) {
    const types = window.APP_CONFIG?.RESOURCE_TYPES || {};
    const typeInfo = types[resource.type] || { icon: 'file', color: '#a1a1aa', label: resource.type };

    // Thumbnail (YouTube thumbnail for videos, placeholder otherwise)
    let thumbnailStyle = '';
    if (resource.type === 'video' && resource.youtube_id) {
      thumbnailStyle = `background-image: url('${this.getYouTubeThumbnail(resource.youtube_id)}')`;
    } else if (resource.thumbnail_url) {
      thumbnailStyle = `background-image: url('${resource.thumbnail_url}')`;
    }

    // Tags
    const tagsHtml = (resource.tags && resource.tags.length)
      ? `<div class="resource-tags">
           ${resource.tags.slice(0, 4).map((t) => `<span class="tag">${this._escapeHtml(t)}</span>`).join('')}
         </div>`
      : '';

    // Meta info
    const dateStr = resource.created_at ? this.formatDate(resource.created_at) : '';
    const category = resource.category ? this._escapeHtml(resource.category) : '';

    return `
      <div class="resource-card glass-card" data-resource-id="${resource.id}">
        <div class="resource-thumbnail" style="${thumbnailStyle}">
          <span class="resource-type-badge" data-type="${resource.type}">
            <i data-lucide="${typeInfo.icon}"></i>
            ${typeInfo.label}
          </span>
          <div class="resource-actions">
            <button class="btn-icon-sm action-favorite" data-action="favorite" title="Favoriet">
              <i data-lucide="${resource.is_favorite ? 'star' : 'star'}"></i>
            </button>
            <button class="btn-icon-sm action-edit" data-action="edit" title="Bewerken">
              <i data-lucide="pencil"></i>
            </button>
            <button class="btn-icon-sm action-delete" data-action="delete" title="Verwijderen">
              <i data-lucide="trash-2"></i>
            </button>
          </div>
        </div>
        <div class="resource-body">
          <h3 class="resource-title">${this._escapeHtml(resource.title || 'Geen titel')}</h3>
          <p class="resource-description">${this._escapeHtml(this.truncate(resource.description || '', 120))}</p>
          ${tagsHtml}
          <div class="resource-meta">
            <span><i data-lucide="calendar"></i> ${dateStr}</span>
            ${category ? `<span><i data-lucide="folder"></i> ${category}</span>` : ''}
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Render a resource list item (list view).
   * @param {Object} resource
   * @returns {string} HTML string
   */
  renderResourceListItem(resource) {
    const types = window.APP_CONFIG?.RESOURCE_TYPES || {};
    const typeInfo = types[resource.type] || { icon: 'file', color: '#a1a1aa', label: resource.type };
    const dateStr = resource.created_at ? this.formatDate(resource.created_at) : '';
    const category = resource.category ? this._escapeHtml(resource.category) : '';

    return `
      <div class="resource-list-item" data-resource-id="${resource.id}">
        <div class="resource-list-icon" style="color: ${typeInfo.color}">
          <i data-lucide="${typeInfo.icon}"></i>
        </div>
        <div class="resource-title" style="flex:1; min-width:0;">${this._escapeHtml(resource.title || 'Geen titel')}</div>
        <span class="resource-type-badge" data-type="${resource.type}" style="flex-shrink:0;">${typeInfo.label}</span>
        ${category ? `<span style="font-size:11px;color:var(--text-muted);flex-shrink:0;">${category}</span>` : ''}
        <span style="font-size:11px;color:var(--text-faint);flex-shrink:0;white-space:nowrap;">${dateStr}</span>
        <div class="resource-actions" style="opacity:1;position:static;transform:none;flex-shrink:0;">
          <button class="btn-icon-sm action-favorite" data-action="favorite" title="Favoriet">
            <i data-lucide="star"></i>
          </button>
          <button class="btn-icon-sm action-edit" data-action="edit" title="Bewerken">
            <i data-lucide="pencil"></i>
          </button>
          <button class="btn-icon-sm action-delete" data-action="delete" title="Verwijderen">
            <i data-lucide="trash-2"></i>
          </button>
        </div>
      </div>
    `;
  }

  /**
   * Render a folder tree item with indentation.
   * @param {Object} folder          - Folder object with id, name, color, children, etc.
   * @param {number} [level=0]       - Nesting level for indentation.
   * @returns {string} HTML string
   */
  renderFolderItem(folder, level = 0) {
    const indent = level * 24;
    const hasChildren = folder.children && folder.children.length > 0;
    const expandIcon = hasChildren
      ? `<i data-lucide="chevron-right" class="folder-expand"></i>`
      : `<span style="width:16px;display:inline-block;"></span>`;

    const childrenHtml = hasChildren
      ? `<div class="folder-children" style="display:none;">
           ${folder.children.map((child) => this.renderFolderItem(child, level + 1)).join('')}
         </div>`
      : '';

    return `
      <div class="folder-tree-node" data-folder-id="${folder.id}">
        <div class="folder-item" style="padding-left: ${12 + indent}px;" data-folder-id="${folder.id}">
          ${expandIcon}
          <i data-lucide="folder" style="color: ${folder.color || 'var(--text-muted)'}"></i>
          <span style="flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
            ${this._escapeHtml(folder.name)}
          </span>
          ${folder.count !== undefined ? `<span class="nav-badge">${folder.count}</span>` : ''}
        </div>
        ${childrenHtml}
      </div>
    `;
  }

  /**
   * Render a sidebar category item.
   * @param {Object} category - Object with icon, name, count.
   * @returns {string} HTML string
   */
  renderCategoryItem(category) {
    return `
      <button class="nav-item" data-category="${this._escapeHtml(category.name)}">
        <i data-lucide="${category.icon || 'tag'}"></i>
        <span>${this._escapeHtml(category.name)}</span>
        <span class="nav-badge">${category.count || 0}</span>
      </button>
    `;
  }

  /**
   * Render a centered empty state block.
   * @param {string}   icon           - Lucide icon name.
   * @param {string}   title          - Heading text.
   * @param {string}   message        - Description text.
   * @param {string}   [actionText]   - Button label (optional).
   * @param {Function} [actionCallback] - Callback on button click (optional).
   * @returns {string} HTML string
   */
  renderEmptyState(icon, title, message, actionText, actionCallback) {
    const btnId = actionText ? `emptyAction_${Date.now()}` : '';
    const buttonHtml = actionText
      ? `<button class="btn btn-primary" id="${btnId}"><i data-lucide="${icon}"></i> ${this._escapeHtml(actionText)}</button>`
      : '';

    // If a callback is supplied, register it after the element is in the DOM
    if (actionText && actionCallback) {
      requestAnimationFrame(() => {
        const btn = document.getElementById(btnId);
        if (btn) btn.addEventListener('click', actionCallback);
      });
    }

    return `
      <div class="empty-state">
        <i data-lucide="${icon}" class="empty-icon"></i>
        <h3>${this._escapeHtml(title)}</h3>
        <p>${this._escapeHtml(message)}</p>
        ${buttonHtml}
      </div>
    `;
  }

  // ---------------------------------------------------------------------------
  // Formatting Utilities
  // ---------------------------------------------------------------------------

  /**
   * Format a date string to Dutch short format: "2 jan 2025".
   * @param {string} dateString
   * @returns {string}
   */
  formatDate(dateString) {
    if (!dateString) return '';
    const months = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
    const d = new Date(dateString);
    if (isNaN(d.getTime())) return '';
    return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
  }

  /**
   * Format seconds into "5:30" or "1:02:15".
   * @param {number} seconds
   * @returns {string}
   */
  formatDuration(seconds) {
    if (!seconds || seconds < 0) return '0:00';
    const s = Math.floor(seconds);
    const hrs = Math.floor(s / 3600);
    const mins = Math.floor((s % 3600) / 60);
    const secs = s % 60;

    if (hrs > 0) {
      return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return `${mins}:${String(secs).padStart(2, '0')}`;
  }

  /**
   * Truncate text to a maximum length with ellipsis.
   * @param {string} text
   * @param {number} maxLength
   * @returns {string}
   */
  truncate(text, maxLength) {
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength).trimEnd() + '\u2026';
  }

  /**
   * Get YouTube thumbnail URL for a given video ID.
   * @param {string} videoId
   * @returns {string}
   */
  getYouTubeThumbnail(videoId) {
    return `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
  }

  // ---------------------------------------------------------------------------
  // Search Modal
  // ---------------------------------------------------------------------------

  /**
   * Initialise the Ctrl+K search modal behaviour.
   * Debounces input by 300ms and renders results.
   */
  initSearchModal() {
    const input = document.getElementById('searchModalInput');
    const resultsContainer = document.getElementById('searchResults');
    if (!input || !resultsContainer) return;

    // Open search from the topbar input as well
    const globalSearch = document.getElementById('globalSearch');
    if (globalSearch) {
      globalSearch.addEventListener('focus', () => {
        this.openModal('modalSearch');
        globalSearch.blur();
        const modalInput = document.getElementById('searchModalInput');
        if (modalInput) {
          modalInput.value = '';
          modalInput.focus();
        }
      });
    }

    // Debounced search
    input.addEventListener('input', () => {
      clearTimeout(this._searchDebounceTimer);
      const query = input.value.trim();

      if (!query) {
        resultsContainer.innerHTML = '<div class="search-empty"><p>Begin met typen om te zoeken...</p></div>';
        return;
      }

      this._searchDebounceTimer = setTimeout(async () => {
        await this._performSearch(query, resultsContainer);
      }, 300);
    });

    // Delegate clicks on search results
    resultsContainer.addEventListener('click', (e) => {
      const item = e.target.closest('.search-result-item');
      if (!item) return;

      const resourceId = item.dataset.resourceId;
      this.closeModal('modalSearch');

      if (resourceId) {
        document.dispatchEvent(new CustomEvent('resource-open', { detail: { id: resourceId } }));
      }
    });
  }

  /**
   * Execute a search and render results into the container.
   * @param {string}      query
   * @param {HTMLElement}  container
   */
  async _performSearch(query, container) {
    // Show loading state
    container.innerHTML = '<div class="search-empty"><div class="spinner"></div></div>';

    try {
      let results = [];

      // Use the database module if available
      if (window.db && typeof window.db.searchResources === 'function') {
        results = await window.db.searchResources(query);
      }

      if (!results || results.length === 0) {
        container.innerHTML = `<div class="search-empty"><p>Geen resultaten gevonden voor "${this._escapeHtml(query)}"</p></div>`;
        return;
      }

      const types = window.APP_CONFIG?.RESOURCE_TYPES || {};

      container.innerHTML = results.map((r) => {
        const typeInfo = types[r.type] || { icon: 'file', color: '#a1a1aa', label: r.type };
        return `
          <div class="search-result-item" data-resource-id="${r.id}">
            <div style="width:32px;height:32px;border-radius:var(--radius-md);display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,0.05);flex-shrink:0;color:${typeInfo.color}">
              <i data-lucide="${typeInfo.icon}"></i>
            </div>
            <div style="flex:1;min-width:0;">
              <div style="font-size:13px;font-weight:500;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                ${this._escapeHtml(r.title || 'Geen titel')}
              </div>
              <div style="font-size:11px;color:var(--text-muted);">
                ${typeInfo.label}${r.category ? ' &middot; ' + this._escapeHtml(r.category) : ''}
              </div>
            </div>
            <i data-lucide="arrow-right" style="width:14px;height:14px;color:var(--text-faint);flex-shrink:0;"></i>
          </div>
        `;
      }).join('');

      this.refreshIcons();
    } catch (err) {
      console.error('[UI] Search error:', err);
      container.innerHTML = '<div class="search-empty"><p>Er ging iets mis bij het zoeken.</p></div>';
    }
  }

  // ---------------------------------------------------------------------------
  // Icon Refresh
  // ---------------------------------------------------------------------------

  /**
   * Re-render Lucide icons for any dynamically inserted content.
   */
  refreshIcons() {
    if (typeof lucide !== 'undefined' && lucide.createIcons) {
      lucide.createIcons();
    }
  }

  // ---------------------------------------------------------------------------
  // Internal Utilities
  // ---------------------------------------------------------------------------

  /**
   * Escape HTML entities to prevent XSS in rendered content.
   * @param {string} str
   * @returns {string}
   */
  _escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}

// ---------------------------------------------------------------------------
// Instantiate
// ---------------------------------------------------------------------------
window.UI = UI;
window.ui = new UI();
