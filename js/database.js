/**
 * SocialNow AI Hub - Database Abstraction Layer
 * Provides all CRUD operations via Supabase.
 * Depends on window.supabaseClient (initialised in config.js).
 */

class Database {
  constructor() {
    this.supabase = window.supabaseClient;
  }

  // =========================================================================
  // RESOURCES
  // =========================================================================

  /**
   * Fetch a filtered, sorted, paginated list of resources.
   * @param {Object} options
   * @returns {Promise<{data: Array, count: number, error: Object|null}>}
   */
  async getResources(options = {}) {
    const {
      userId,
      type,
      status,
      folderId,
      categoryId,
      isFavorite,
      search,
      sortBy = 'created_at',
      sortDir = 'desc',
      limit = 24,
      offset = 0
    } = options;

    try {
      let query = this.supabase
        .from('resources')
        .select('*, categories(name, icon, color)', { count: 'exact' });

      if (userId) query = query.eq('user_id', userId);
      if (type) query = query.eq('type', type);
      if (status) query = query.eq('status', status);
      if (folderId) query = query.eq('folder_id', folderId);
      if (categoryId) query = query.eq('category_id', categoryId);
      if (typeof isFavorite === 'boolean') query = query.eq('is_favorite', isFavorite);

      if (search) {
        query = query.textSearch('search_vector', search);
      }

      query = query.order(sortBy, { ascending: sortDir === 'asc' });
      query = query.range(offset, offset + limit - 1);

      const { data, count, error } = await query;
      return { data, count, error };
    } catch (error) {
      return { data: null, count: 0, error };
    }
  }

  /**
   * Fetch a single resource with all related data.
   * @param {string} id
   * @returns {Promise<{data: Object|null, error: Object|null}>}
   */
  async getResource(id) {
    try {
      const { data, error } = await this.supabase
        .from('resources')
        .select(`
          *,
          categories(name, icon, color),
          resource_tags(tags(id, name, color)),
          folders(id, name, icon, color)
        `)
        .eq('id', id)
        .single();

      return { data, error };
    } catch (error) {
      return { data: null, error };
    }
  }

  /**
   * Insert a new resource.
   * @param {Object} resource
   * @returns {Promise<{data: Object|null, error: Object|null}>}
   */
  async createResource(resource) {
    try {
      const { data, error } = await this.supabase
        .from('resources')
        .insert(resource)
        .select()
        .single();

      return { data, error };
    } catch (error) {
      return { data: null, error };
    }
  }

  /**
   * Update an existing resource.
   * @param {string} id
   * @param {Object} updates
   * @returns {Promise<{data: Object|null, error: Object|null}>}
   */
  async updateResource(id, updates) {
    try {
      const { data, error } = await this.supabase
        .from('resources')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      return { data, error };
    } catch (error) {
      return { data: null, error };
    }
  }

  /**
   * Delete a resource by id.
   * @param {string} id
   * @returns {Promise<{error: Object|null}>}
   */
  async deleteResource(id) {
    try {
      const { error } = await this.supabase
        .from('resources')
        .delete()
        .eq('id', id);

      return { error };
    } catch (error) {
      return { error };
    }
  }

  /**
   * Toggle the is_favorite flag on a resource.
   * @param {string} id
   * @param {boolean} currentState
   * @returns {Promise<{data: Object|null, error: Object|null}>}
   */
  async toggleFavorite(id, currentState) {
    try {
      const { data, error } = await this.supabase
        .from('resources')
        .update({ is_favorite: !currentState })
        .eq('id', id)
        .select()
        .single();

      return { data, error };
    } catch (error) {
      return { data: null, error };
    }
  }

  /**
   * Get aggregate counts for a user's resources, broken down by type,
   * plus favorites, inbox and folder counts.
   * @param {string} userId
   * @returns {Promise<Object>}
   */
  async getResourceCounts(userId) {
    const counts = {
      video: 0,
      article: 0,
      tool: 0,
      prompt: 0,
      note: 0,
      total: 0,
      favorites: 0,
      inbox: 0,
      folders: 0
    };

    try {
      // Count per resource type
      const types = ['video', 'article', 'tool', 'prompt', 'note'];
      const typePromises = types.map((type) =>
        this.supabase
          .from('resources')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId)
          .eq('type', type)
      );

      // Favorites count
      const favoritesPromise = this.supabase
        .from('resources')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('is_favorite', true);

      // Inbox count (resources without a folder)
      const inboxPromise = this.supabase
        .from('resources')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .is('folder_id', null);

      // Folders count
      const foldersPromise = this.supabase
        .from('folders')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId);

      const results = await Promise.all([
        ...typePromises,
        favoritesPromise,
        inboxPromise,
        foldersPromise
      ]);

      types.forEach((type, i) => {
        counts[type] = results[i].count || 0;
      });

      counts.favorites = results[types.length].count || 0;
      counts.inbox = results[types.length + 1].count || 0;
      counts.folders = results[types.length + 2].count || 0;
      counts.total = types.reduce((sum, type) => sum + counts[type], 0);

      return counts;
    } catch (error) {
      console.error('Database: getResourceCounts failed', error);
      return counts;
    }
  }

  /**
   * Full-text search with ILIKE fallback. Results are deduplicated.
   * @param {string} userId
   * @param {string} query
   * @returns {Promise<{data: Array, error: Object|null}>}
   */
  async searchResources(userId, query) {
    try {
      // Full-text search via search_vector
      const ftsPromise = this.supabase
        .from('resources')
        .select('*, categories(name, icon, color)')
        .eq('user_id', userId)
        .textSearch('search_vector', query)
        .limit(50);

      // ILIKE fallback on title
      const ilikePromise = this.supabase
        .from('resources')
        .select('*, categories(name, icon, color)')
        .eq('user_id', userId)
        .ilike('title', `%${query}%`)
        .limit(50);

      const [ftsResult, ilikeResult] = await Promise.all([ftsPromise, ilikePromise]);

      // Merge and deduplicate
      const seen = new Set();
      const combined = [];

      const addUnique = (items) => {
        if (!items) return;
        for (const item of items) {
          if (!seen.has(item.id)) {
            seen.add(item.id);
            combined.push(item);
          }
        }
      };

      addUnique(ftsResult.data);
      addUnique(ilikeResult.data);

      const error = ftsResult.error && ilikeResult.error
        ? ftsResult.error
        : null;

      return { data: combined, error };
    } catch (error) {
      return { data: null, error };
    }
  }

  // =========================================================================
  // FOLDERS
  // =========================================================================

  /**
   * Fetch all folders for a user, ordered by sort_order then name.
   * @param {string} userId
   * @returns {Promise<{data: Array, error: Object|null}>}
   */
  async getFolders(userId) {
    try {
      const { data, error } = await this.supabase
        .from('folders')
        .select('*')
        .eq('user_id', userId)
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true });

      return { data, error };
    } catch (error) {
      return { data: null, error };
    }
  }

  /**
   * Insert a new folder.
   * @param {Object} folder
   * @returns {Promise<{data: Object|null, error: Object|null}>}
   */
  async createFolder(folder) {
    try {
      const { data, error } = await this.supabase
        .from('folders')
        .insert(folder)
        .select()
        .single();

      return { data, error };
    } catch (error) {
      return { data: null, error };
    }
  }

  /**
   * Update an existing folder.
   * @param {string} id
   * @param {Object} updates
   * @returns {Promise<{data: Object|null, error: Object|null}>}
   */
  async updateFolder(id, updates) {
    try {
      const { data, error } = await this.supabase
        .from('folders')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      return { data, error };
    } catch (error) {
      return { data: null, error };
    }
  }

  /**
   * Delete a folder. Cascade rules in the database handle children.
   * @param {string} id
   * @returns {Promise<{error: Object|null}>}
   */
  async deleteFolder(id) {
    try {
      const { error } = await this.supabase
        .from('folders')
        .delete()
        .eq('id', id);

      return { error };
    } catch (error) {
      return { error };
    }
  }

  /**
   * Build a nested folder tree from a flat list of folders.
   * @param {string} userId
   * @returns {Promise<Array>}
   */
  async getFolderTree(userId) {
    try {
      const { data: folders, error } = await this.getFolders(userId);
      if (error || !folders) return [];

      const map = {};
      const roots = [];

      // Index every folder by id
      for (const folder of folders) {
        map[folder.id] = { ...folder, children: [] };
      }

      // Build the tree
      for (const folder of folders) {
        if (folder.parent_id && map[folder.parent_id]) {
          map[folder.parent_id].children.push(map[folder.id]);
        } else {
          roots.push(map[folder.id]);
        }
      }

      return roots;
    } catch (error) {
      console.error('Database: getFolderTree failed', error);
      return [];
    }
  }

  // =========================================================================
  // CATEGORIES
  // =========================================================================

  /**
   * Fetch all categories ordered by sort_order then name.
   * @param {string} userId
   * @returns {Promise<{data: Array, error: Object|null}>}
   */
  async getCategories(userId) {
    try {
      const { data, error } = await this.supabase
        .from('categories')
        .select('*')
        .eq('user_id', userId)
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true });

      return { data, error };
    } catch (error) {
      return { data: null, error };
    }
  }

  /**
   * Insert a new category.
   * @param {Object} category
   * @returns {Promise<{data: Object|null, error: Object|null}>}
   */
  async createCategory(category) {
    try {
      const { data, error } = await this.supabase
        .from('categories')
        .insert(category)
        .select()
        .single();

      return { data, error };
    } catch (error) {
      return { data: null, error };
    }
  }

  /**
   * Update an existing category.
   * @param {string} id
   * @param {Object} updates
   * @returns {Promise<{data: Object|null, error: Object|null}>}
   */
  async updateCategory(id, updates) {
    try {
      const { data, error } = await this.supabase
        .from('categories')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      return { data, error };
    } catch (error) {
      return { data: null, error };
    }
  }

  // =========================================================================
  // TAGS
  // =========================================================================

  /**
   * Fetch all tags for a user ordered by usage_count descending.
   * @param {string} userId
   * @returns {Promise<{data: Array, error: Object|null}>}
   */
  async getTags(userId) {
    try {
      const { data, error } = await this.supabase
        .from('tags')
        .select('*')
        .eq('user_id', userId)
        .order('usage_count', { ascending: false });

      return { data, error };
    } catch (error) {
      return { data: null, error };
    }
  }

  /**
   * Insert a tag. Uses upsert to handle name conflicts gracefully.
   * @param {Object} tag
   * @returns {Promise<{data: Object|null, error: Object|null}>}
   */
  async createTag(tag) {
    try {
      const { data, error } = await this.supabase
        .from('tags')
        .upsert(tag, { onConflict: 'name, user_id' })
        .select()
        .single();

      return { data, error };
    } catch (error) {
      return { data: null, error };
    }
  }

  /**
   * Link a tag to a resource and increment the tag's usage_count.
   * @param {string} resourceId
   * @param {string} tagId
   * @returns {Promise<{error: Object|null}>}
   */
  async addTagToResource(resourceId, tagId) {
    try {
      const { error: linkError } = await this.supabase
        .from('resource_tags')
        .insert({ resource_id: resourceId, tag_id: tagId });

      if (linkError) return { error: linkError };

      const { error: countError } = await this.supabase.rpc('increment_tag_usage', {
        tag_id_input: tagId
      });

      return { error: countError };
    } catch (error) {
      return { error };
    }
  }

  /**
   * Unlink a tag from a resource and decrement the tag's usage_count.
   * @param {string} resourceId
   * @param {string} tagId
   * @returns {Promise<{error: Object|null}>}
   */
  async removeTagFromResource(resourceId, tagId) {
    try {
      const { error: linkError } = await this.supabase
        .from('resource_tags')
        .delete()
        .eq('resource_id', resourceId)
        .eq('tag_id', tagId);

      if (linkError) return { error: linkError };

      const { error: countError } = await this.supabase.rpc('decrement_tag_usage', {
        tag_id_input: tagId
      });

      return { error: countError };
    } catch (error) {
      return { error };
    }
  }

  // =========================================================================
  // COLLECTIONS
  // =========================================================================

  /**
   * Fetch all collections for a user.
   * @param {string} userId
   * @returns {Promise<{data: Array, error: Object|null}>}
   */
  async getCollections(userId) {
    try {
      const { data, error } = await this.supabase
        .from('collections')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      return { data, error };
    } catch (error) {
      return { data: null, error };
    }
  }

  /**
   * Insert a new collection.
   * @param {Object} collection
   * @returns {Promise<{data: Object|null, error: Object|null}>}
   */
  async createCollection(collection) {
    try {
      const { data, error } = await this.supabase
        .from('collections')
        .insert(collection)
        .select()
        .single();

      return { data, error };
    } catch (error) {
      return { data: null, error };
    }
  }

  /**
   * Add a resource to a collection.
   * @param {string} collectionId
   * @param {string} resourceId
   * @returns {Promise<{error: Object|null}>}
   */
  async addToCollection(collectionId, resourceId) {
    try {
      const { error } = await this.supabase
        .from('collection_resources')
        .insert({ collection_id: collectionId, resource_id: resourceId });

      return { error };
    } catch (error) {
      return { error };
    }
  }

  // =========================================================================
  // CHAT
  // =========================================================================

  /**
   * Fetch all chat sessions for a user, newest first.
   * @param {string} userId
   * @returns {Promise<{data: Array, error: Object|null}>}
   */
  async getChatSessions(userId) {
    try {
      const { data, error } = await this.supabase
        .from('chat_sessions')
        .select('*')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false });

      return { data, error };
    } catch (error) {
      return { data: null, error };
    }
  }

  /**
   * Insert a new chat session.
   * @param {Object} session
   * @returns {Promise<{data: Object|null, error: Object|null}>}
   */
  async createChatSession(session) {
    try {
      const { data, error } = await this.supabase
        .from('chat_sessions')
        .insert(session)
        .select()
        .single();

      return { data, error };
    } catch (error) {
      return { data: null, error };
    }
  }

  /**
   * Fetch all messages for a chat session in chronological order.
   * @param {string} sessionId
   * @returns {Promise<{data: Array, error: Object|null}>}
   */
  async getChatMessages(sessionId) {
    try {
      const { data, error } = await this.supabase
        .from('chat_messages')
        .select('*')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: true });

      return { data, error };
    } catch (error) {
      return { data: null, error };
    }
  }

  /**
   * Insert a message and touch the session's updated_at timestamp.
   * @param {Object} message
   * @returns {Promise<{data: Object|null, error: Object|null}>}
   */
  async addChatMessage(message) {
    try {
      const { data, error } = await this.supabase
        .from('chat_messages')
        .insert(message)
        .select()
        .single();

      if (error) return { data: null, error };

      // Update the parent session timestamp
      await this.supabase
        .from('chat_sessions')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', message.session_id);

      return { data, error: null };
    } catch (error) {
      return { data: null, error };
    }
  }

  // =========================================================================
  // ACTIVITY
  // =========================================================================

  /**
   * Write an entry to the activity log.
   * @param {string} userId
   * @param {string} action
   * @param {string} resourceType
   * @param {string} resourceId
   * @param {Object} metadata
   * @returns {Promise<{error: Object|null}>}
   */
  async logActivity(userId, action, resourceType, resourceId, metadata = {}) {
    try {
      const { error } = await this.supabase
        .from('activity_log')
        .insert({
          user_id: userId,
          action,
          resource_type: resourceType,
          resource_id: resourceId,
          metadata
        });

      return { error };
    } catch (error) {
      return { error };
    }
  }

  /**
   * Fetch recent activity entries for a user.
   * @param {string} userId
   * @param {number} limit
   * @returns {Promise<{data: Array, error: Object|null}>}
   */
  async getRecentActivity(userId, limit = 20) {
    try {
      const { data, error } = await this.supabase
        .from('activity_log')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit);

      return { data, error };
    } catch (error) {
      return { data: null, error };
    }
  }
}

// ---------------------------------------------------------------------------
// Expose globally
// ---------------------------------------------------------------------------
window.Database = Database;
window.db = new Database();
