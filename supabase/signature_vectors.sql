alter table public.signatures
  add column if not exists svg_data text,
  add column if not exists vector_version integer not null default 0;

comment on column public.signatures.svg_data is
  'SVG vectorial con paths reales. image_url conserva el PNG de respaldo.';

comment on column public.signatures.vector_version is
  'Versión del algoritmo de vectorización; 0 significa firma raster antigua.';

grant select, insert, update on public.signatures to authenticated;
