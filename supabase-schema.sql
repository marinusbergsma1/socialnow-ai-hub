-- =============================================
-- SocialNow AI Hub - Supabase Database Schema
-- =============================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================
-- 1. PROFILES (extends Supabase auth.users)
-- =============================================
CREATE TABLE IF NOT EXISTS profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email TEXT,
  display_name TEXT,
  avatar_url TEXT,
  role TEXT DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  preferences JSONB DEFAULT '{"theme": "dark", "language": "nl", "auto_categorize": true}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-create profile on user signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, email, display_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- =============================================
-- 2. FOLDERS (nested folder structure)
-- =============================================
CREATE TABLE IF NOT EXISTS folders (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  parent_id UUID REFERENCES folders(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  icon TEXT DEFAULT 'folder',
  color TEXT DEFAULT '#25D366',
  description TEXT,
  sort_order INTEGER DEFAULT 0,
  is_pinned BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_folders_user ON folders(user_id);
CREATE INDEX idx_folders_parent ON folders(parent_id);

-- =============================================
-- 3. CATEGORIES (AI auto-categories)
-- =============================================
CREATE TABLE IF NOT EXISTS categories (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  icon TEXT DEFAULT 'tag',
  color TEXT DEFAULT '#25D366',
  description TEXT,
  parent_id UUID REFERENCES categories(id) ON DELETE SET NULL,
  auto_rules JSONB DEFAULT '[]'::jsonb, -- keywords for auto-categorization
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, slug)
);

CREATE INDEX idx_categories_user ON categories(user_id);

-- =============================================
-- 4. TAGS
-- =============================================
CREATE TABLE IF NOT EXISTS tags (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  color TEXT DEFAULT '#3f3f46',
  usage_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, name)
);

CREATE INDEX idx_tags_user ON tags(user_id);

-- =============================================
-- 5. RESOURCES (main content table)
-- =============================================
CREATE TYPE resource_type AS ENUM ('video', 'article', 'note', 'tool', 'prompt', 'tutorial', 'course', 'bookmark', 'snippet');
CREATE TYPE resource_status AS ENUM ('inbox', 'processing', 'active', 'archived', 'favorite');

CREATE TABLE IF NOT EXISTS resources (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  folder_id UUID REFERENCES folders(id) ON DELETE SET NULL,
  category_id UUID REFERENCES categories(id) ON DELETE SET NULL,

  -- Core fields
  type resource_type NOT NULL DEFAULT 'bookmark',
  status resource_status DEFAULT 'inbox',
  title TEXT NOT NULL,
  description TEXT,
  url TEXT,
  thumbnail_url TEXT,

  -- Video-specific
  video_id TEXT,                    -- YouTube/Vimeo ID
  video_platform TEXT,              -- youtube, vimeo, etc
  video_duration INTEGER,           -- seconds
  video_channel TEXT,
  video_published_at TIMESTAMPTZ,

  -- Content extraction
  transcript TEXT,                  -- Full transcript
  summary_short TEXT,               -- 1-2 sentences
  summary_medium TEXT,              -- 1 paragraph
  summary_detailed TEXT,            -- Full summary
  key_points JSONB DEFAULT '[]'::jsonb,  -- Array of key takeaways

  -- AI metadata
  ai_categories JSONB DEFAULT '[]'::jsonb,   -- AI-suggested categories
  ai_topics JSONB DEFAULT '[]'::jsonb,       -- Extracted topics
  ai_difficulty TEXT CHECK (ai_difficulty IN ('beginner', 'intermediate', 'advanced', 'expert')),
  ai_relevance_score NUMERIC(3,2),           -- 0-1 relevance score
  ai_language TEXT DEFAULT 'nl',

  -- User metadata
  notes TEXT,                       -- Personal notes
  rating INTEGER CHECK (rating BETWEEN 1 AND 5),
  is_favorite BOOLEAN DEFAULT FALSE,
  is_pinned BOOLEAN DEFAULT FALSE,
  view_count INTEGER DEFAULT 0,
  last_viewed_at TIMESTAMPTZ,

  -- Search
  search_vector TSVECTOR,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_resources_user ON resources(user_id);
CREATE INDEX idx_resources_folder ON resources(folder_id);
CREATE INDEX idx_resources_category ON resources(category_id);
CREATE INDEX idx_resources_type ON resources(type);
CREATE INDEX idx_resources_status ON resources(status);
CREATE INDEX idx_resources_search ON resources USING GIN(search_vector);
CREATE INDEX idx_resources_favorite ON resources(user_id, is_favorite) WHERE is_favorite = TRUE;

-- Auto-update search vector
CREATE OR REPLACE FUNCTION update_resource_search_vector()
RETURNS TRIGGER AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('dutch', COALESCE(NEW.title, '')), 'A') ||
    setweight(to_tsvector('dutch', COALESCE(NEW.description, '')), 'B') ||
    setweight(to_tsvector('dutch', COALESCE(NEW.summary_short, '')), 'B') ||
    setweight(to_tsvector('dutch', COALESCE(NEW.transcript, '')), 'C') ||
    setweight(to_tsvector('dutch', COALESCE(NEW.notes, '')), 'B');
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER resource_search_update
  BEFORE INSERT OR UPDATE ON resources
  FOR EACH ROW EXECUTE FUNCTION update_resource_search_vector();

-- =============================================
-- 6. RESOURCE_TAGS (many-to-many)
-- =============================================
CREATE TABLE IF NOT EXISTS resource_tags (
  resource_id UUID REFERENCES resources(id) ON DELETE CASCADE,
  tag_id UUID REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (resource_id, tag_id)
);

-- =============================================
-- 7. COLLECTIONS (curated lists)
-- =============================================
CREATE TABLE IF NOT EXISTS collections (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  icon TEXT DEFAULT 'layout-grid',
  color TEXT DEFAULT '#25D366',
  is_public BOOLEAN DEFAULT FALSE,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS collection_resources (
  collection_id UUID REFERENCES collections(id) ON DELETE CASCADE,
  resource_id UUID REFERENCES resources(id) ON DELETE CASCADE,
  sort_order INTEGER DEFAULT 0,
  added_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (collection_id, resource_id)
);

-- =============================================
-- 8. AI CHAT HISTORY
-- =============================================
CREATE TABLE IF NOT EXISTS chat_sessions (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  title TEXT DEFAULT 'Nieuwe chat',
  context_resource_id UUID REFERENCES resources(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  session_id UUID REFERENCES chat_sessions(id) ON DELETE CASCADE NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_chat_messages_session ON chat_messages(session_id);

-- =============================================
-- 9. ACTIVITY LOG
-- =============================================
CREATE TABLE IF NOT EXISTS activity_log (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id UUID,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_activity_user ON activity_log(user_id, created_at DESC);

-- =============================================
-- 10. DEFAULT CATEGORIES (seeded on signup)
-- =============================================
CREATE OR REPLACE FUNCTION seed_default_categories()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO categories (user_id, name, slug, icon, color, description, auto_rules) VALUES
    (NEW.id, 'AI Basics', 'ai-basics', 'brain', '#25D366', 'Fundamentals of AI and ML', '["artificial intelligence", "machine learning", "neural network", "deep learning", "AI basics"]'::jsonb),
    (NEW.id, 'Prompt Engineering', 'prompt-engineering', 'message-square', '#FFD700', 'Prompts, techniques and strategies', '["prompt engineering", "prompting", "chain of thought", "few-shot", "zero-shot", "prompt template"]'::jsonb),
    (NEW.id, 'ChatGPT & LLMs', 'chatgpt-llms', 'bot', '#10A37F', 'ChatGPT, Claude, Gemini etc.', '["chatgpt", "gpt-4", "claude", "gemini", "llm", "language model", "openai"]'::jsonb),
    (NEW.id, 'AI Tools', 'ai-tools', 'wrench', '#FF6B6B', 'AI powered tools and services', '["ai tool", "midjourney", "dalle", "stable diffusion", "cursor", "copilot", "v0"]'::jsonb),
    (NEW.id, 'Automation', 'automation', 'zap', '#FF9500', 'Workflow automation with AI', '["automation", "make.com", "zapier", "n8n", "workflow", "api integration"]'::jsonb),
    (NEW.id, 'Web Development', 'web-development', 'code', '#61DAFB', 'AI in web development', '["html", "css", "javascript", "react", "next.js", "web development", "coding"]'::jsonb),
    (NEW.id, 'Design & Creative', 'design-creative', 'palette', '#FF61D3', 'AI for design and creative work', '["design", "creative", "figma", "canva", "image generation", "art"]'::jsonb),
    (NEW.id, 'Marketing & Content', 'marketing-content', 'megaphone', '#25D366', 'AI for marketing and content', '["marketing", "seo", "content creation", "copywriting", "social media"]'::jsonb),
    (NEW.id, 'Tutorials & Courses', 'tutorials-courses', 'graduation-cap', '#6366F1', 'Learning resources', '["tutorial", "course", "learn", "training", "workshop"]'::jsonb),
    (NEW.id, 'Inspiratie', 'inspiratie', 'sparkles', '#FFD700', 'Inspiratie en ideeën', '["inspiration", "inspiratie", "idea", "creative", "innovation"]'::jsonb);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER on_profile_created_seed_categories
  AFTER INSERT ON profiles
  FOR EACH ROW EXECUTE FUNCTION seed_default_categories();

-- =============================================
-- 11. ROW LEVEL SECURITY
-- =============================================
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE resource_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE collection_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;

-- Profiles
CREATE POLICY "Users can view own profile" ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);

-- Folders
CREATE POLICY "Users can CRUD own folders" ON folders FOR ALL USING (auth.uid() = user_id);

-- Categories
CREATE POLICY "Users can CRUD own categories" ON categories FOR ALL USING (auth.uid() = user_id);

-- Tags
CREATE POLICY "Users can CRUD own tags" ON tags FOR ALL USING (auth.uid() = user_id);

-- Resources
CREATE POLICY "Users can CRUD own resources" ON resources FOR ALL USING (auth.uid() = user_id);

-- Resource Tags
CREATE POLICY "Users can CRUD own resource_tags" ON resource_tags FOR ALL
  USING (EXISTS (SELECT 1 FROM resources WHERE resources.id = resource_tags.resource_id AND resources.user_id = auth.uid()));

-- Collections
CREATE POLICY "Users can CRUD own collections" ON collections FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users can CRUD own collection_resources" ON collection_resources FOR ALL
  USING (EXISTS (SELECT 1 FROM collections WHERE collections.id = collection_resources.collection_id AND collections.user_id = auth.uid()));

-- Chat
CREATE POLICY "Users can CRUD own chat_sessions" ON chat_sessions FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users can CRUD own chat_messages" ON chat_messages FOR ALL
  USING (EXISTS (SELECT 1 FROM chat_sessions WHERE chat_sessions.id = chat_messages.session_id AND chat_sessions.user_id = auth.uid()));

-- Activity
CREATE POLICY "Users can view own activity" ON activity_log FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own activity" ON activity_log FOR INSERT WITH CHECK (auth.uid() = user_id);
