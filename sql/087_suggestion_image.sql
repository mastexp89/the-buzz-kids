-- 087: let edit_suggestions carry an uploaded image (a poster / photo the
-- submitter attaches on the "List your activity" form or Suggest an edit).
alter table public.edit_suggestions add column if not exists image_url text;

notify pgrst, 'reload schema';
