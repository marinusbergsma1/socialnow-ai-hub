/**
 * SocialNow AI Hub - Configuration
 * Initializes Supabase client and holds app-wide configuration.
 */

// ---------------------------------------------------------------------------
// Supabase Client
// ---------------------------------------------------------------------------
const SUPABASE_URL = 'https://rssngbdpgcxkkmaiekqe.supabase.co';
const SUPABASE_KEY = 'sb_publishable_vttah5CF2e27Wjw0fYGebQ_g8jewEmD';

window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ---------------------------------------------------------------------------
// App Configuration
// ---------------------------------------------------------------------------
window.APP_CONFIG = {
  APP_NAME: 'SocialNow AI Hub',
  VERSION: '1.0.0',
  DEFAULT_THEME: 'dark',

  // Supabase (used by transcript Edge Function calls)
  SUPABASE_URL: SUPABASE_URL,
  SUPABASE_ANON_KEY: SUPABASE_KEY,

  // YouTube
  YOUTUBE_OEMBED_URL: 'https://www.youtube.com/oembed',
  YOUTUBE_NOCOOKIE_URL: 'https://www.youtube-nocookie.com/embed/',

  // Pagination & search
  MAX_SEARCH_RESULTS: 50,
  ITEMS_PER_PAGE: 24,

  // Features
  AUTO_CATEGORIZE: true,

  // Resource types with Lucide / Font Awesome icon names, brand colour and
  // Dutch label used throughout the UI.
  RESOURCE_TYPES: {
    video: {
      icon: 'play-circle',
      color: '#25D366',
      label: 'Video'
    },
    article: {
      icon: 'file-text',
      color: '#FFD700',
      label: 'Artikel'
    },
    tool: {
      icon: 'wrench',
      color: '#FF6B6B',
      label: 'AI Tool'
    },
    prompt: {
      icon: 'message-square',
      color: '#61DAFB',
      label: 'Prompt'
    },
    note: {
      icon: 'sticky-note',
      color: '#FF9500',
      label: 'Notitie'
    },
    tutorial: {
      icon: 'graduation-cap',
      color: '#6366F1',
      label: 'Tutorial'
    },
    course: {
      icon: 'book-open',
      color: '#6366F1',
      label: 'Cursus'
    },
    bookmark: {
      icon: 'bookmark',
      color: '#a1a1aa',
      label: 'Bookmark'
    },
    snippet: {
      icon: 'code',
      color: '#61DAFB',
      label: 'Code Snippet'
    }
  },

  // AI difficulty levels shown on resource cards and filters.
  AI_DIFFICULTY_LEVELS: {
    beginner: {
      label: 'Beginner',
      color: '#25D366'
    },
    intermediate: {
      label: 'Intermediate',
      color: '#FFD700'
    },
    advanced: {
      label: 'Advanced',
      color: '#FF6B6B'
    },
    expert: {
      label: 'Expert',
      color: '#6366F1'
    }
  }
};
