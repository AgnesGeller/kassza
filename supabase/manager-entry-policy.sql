drop policy if exists "entries_insert_own" on public.entries;
create policy "entries_insert_own" on public.entries for insert to authenticated
with check (
  (user_id = auth.uid() and leader_name = (select display_name from public.profiles where id = auth.uid()))
  or
  (public.is_manager() and leader_name = (select display_name from public.profiles where id = user_id))
);
