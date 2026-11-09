-- PROPOSAL ONLY. Removes the D4 functions. Data that was already erased by them cannot be restored.
drop function if exists public.delete_my_data(text);
drop function if exists private.erase_student_data(uuid);
