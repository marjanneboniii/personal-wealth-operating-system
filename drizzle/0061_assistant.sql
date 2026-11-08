-- دستیار هوشمند: conversations, messages, what the user told the assistant to
-- remember, and the cached dashboard analysis. Message and memory text is
-- stored AES-GCM encrypted (src/lib/fieldEncryption.ts). Additive only.
CREATE TABLE IF NOT EXISTS public.assistant_conversations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz,
 deleted_at timestamptz,
 user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
 title text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS assistant_conversations_user_idx ON public.assistant_conversations(user_id, updated_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.assistant_messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 created_at timestamptz NOT NULL DEFAULT now(),
 user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
 conversation_id uuid NOT NULL REFERENCES public.assistant_conversations(id) ON DELETE CASCADE,
 role text NOT NULL CHECK (role IN ('user','model')),
 content_enc text NOT NULL,
 meta jsonb NOT NULL DEFAULT '{}'::jsonb
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS assistant_messages_conversation_idx ON public.assistant_messages(conversation_id, created_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.assistant_memories (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz,
 user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK (kind IN ('goal','preference','constraint','fact')),
 content_enc text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS assistant_memories_user_idx ON public.assistant_memories(user_id, created_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.assistant_insights (
 user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
 snapshot_hash text NOT NULL,
 model text NOT NULL,
 content_enc text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE public.assistant_conversations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.assistant_messages ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.assistant_memories ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.assistant_insights ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.assistant_conversations, public.assistant_messages, public.assistant_memories, public.assistant_insights FROM PUBLIC;
--> statement-breakpoint
DO $$ DECLARE role_name text; BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
   EXECUTE format('REVOKE ALL ON public.assistant_conversations, public.assistant_messages, public.assistant_memories, public.assistant_insights FROM %I', role_name);
  END IF;
 END LOOP;
END $$;
