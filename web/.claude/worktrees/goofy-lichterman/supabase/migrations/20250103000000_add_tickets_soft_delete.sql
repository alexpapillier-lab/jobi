-- Add deleted_at column to tickets table for soft delete
ALTER TABLE public.tickets
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Create index for faster filtering of non-deleted tickets
CREATE INDEX IF NOT EXISTS idx_tickets_deleted_at 
  ON public.tickets(deleted_at) 
  WHERE deleted_at IS NULL;

-- Note: UPDATE policy for deleted_at is now handled via RPC functions
-- (soft_delete_ticket and restore_ticket) which enforce owner/admin authorization.
-- The standard UPDATE policy should allow members to update other fields.
-- If a default UPDATE policy doesn't exist, it should be created separately
-- to allow members to update tickets (excluding deleted_at changes).

