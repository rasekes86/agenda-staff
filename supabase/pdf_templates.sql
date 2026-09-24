create table if not exists public.pdf_templates (
  id text primary key,
  name text not null,
  slots jsonb not null default '[]'::jsonb,
  user_id uuid not null references auth.users(id) on delete cascade,
  user_name text not null default 'Usuario',
  created_at timestamptz not null default now()
);

create unique index if not exists pdf_templates_name_ci_unique
  on public.pdf_templates (lower(btrim(name)));

alter table public.pdf_templates enable row level security;

drop policy if exists "Authenticated users can view PDF templates" on public.pdf_templates;
create policy "Authenticated users can view PDF templates"
  on public.pdf_templates for select
  to authenticated
  using (true);

drop policy if exists "Authenticated users can create PDF templates" on public.pdf_templates;
create policy "Authenticated users can create PDF templates"
  on public.pdf_templates for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Owners can delete PDF templates" on public.pdf_templates;
create policy "Owners can delete PDF templates"
  on public.pdf_templates for delete
  to authenticated
  using (auth.uid() = user_id);

grant select, insert, delete on public.pdf_templates to authenticated;
revoke all on public.pdf_templates from anon;
