-- Interní komentáře (chat) k zakázce – dřív jen v localStorage prohlížeče
-- ("jobsheet_ticket_comments_v1"), takže nebyly sdílené mezi kolegy/zařízeními
-- a mohly kdykoliv zmizet smazáním cache. Tahle tabulka je dělá trvalé a sdílené.
CREATE TABLE IF NOT EXISTS public.ticket_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  author text NOT NULL DEFAULT 'Servis',
  author_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  author_nickname text,
  author_avatar_url text,
  content text NOT NULL,
  pinned boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ticket_comments_ticket_id ON public.ticket_comments(ticket_id);
CREATE INDEX IF NOT EXISTS idx_ticket_comments_service_id ON public.ticket_comments(service_id);
CREATE INDEX IF NOT EXISTS idx_ticket_comments_created_at ON public.ticket_comments(created_at);

ALTER TABLE public.ticket_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ticket_comments_select_service_members"
  ON public.ticket_comments
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.service_memberships m
      WHERE m.service_id = ticket_comments.service_id AND m.user_id = auth.uid()
    )
  );

CREATE POLICY "ticket_comments_insert_service_members"
  ON public.ticket_comments
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.service_memberships m
      WHERE m.service_id = ticket_comments.service_id AND m.user_id = auth.uid()
    )
  );

-- UPDATE jen kvůli "Pin/Unpin" v UI (kdokoliv ze servisu smí připnout/odepnout
-- cizí komentář, stejně jako to dřív dělal lokální chat bez omezení na autora).
CREATE POLICY "ticket_comments_update_service_members"
  ON public.ticket_comments
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.service_memberships m
      WHERE m.service_id = ticket_comments.service_id AND m.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.service_memberships m
      WHERE m.service_id = ticket_comments.service_id AND m.user_id = auth.uid()
    )
  );

CREATE POLICY "ticket_comments_delete_service_members"
  ON public.ticket_comments
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.service_memberships m
      WHERE m.service_id = ticket_comments.service_id AND m.user_id = auth.uid()
    )
  );

COMMENT ON TABLE public.ticket_comments IS 'Interní komentáře (chat) k zakázce – sdílené mezi členy servisu, vidí je i historicky importovaná data.';
