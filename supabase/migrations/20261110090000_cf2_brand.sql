-- ============================================================================
-- Migration: 20261110090000_cf2_brand.sql
-- Module: CF2 — Marca (/mnt/project-files/configuracoes/levantamento.md §2)
--
-- Maintenance Rationale:
-- 1. `public.partner_brands` gains the remaining brand fields: a logo for the
--    dark theme, the favicon, the share image (Open Graph), a tagline, a
--    plain-text footer and the WhatsApp sales contact shown on the login.
-- 2. Images stay in the row, like the P3 logo, so the brand still works
--    without a storage service. Only raster formats are accepted (no SVG);
--    the application checks the real file type by its signature and the
--    checks below repeat the size and type limits.
-- 3. The footer is plain text: links are written as addresses and turned
--    into links by the page, never stored as HTML.
-- 4. Rows stay insert-only and the P3/P4a policies are unchanged: every new
--    version copies the fields it keeps.
-- ============================================================================

alter table public.partner_brands
  add column logo_dark        bytea check (logo_dark is null or octet_length(logo_dark) between 1 and 262144),
  add column logo_dark_mime   text check (logo_dark_mime in ('image/png', 'image/jpeg', 'image/webp')),
  add column favicon          bytea check (favicon is null or octet_length(favicon) between 1 and 65536),
  add column favicon_mime     text check (favicon_mime in ('image/png', 'image/x-icon')),
  add column share_image      bytea check (share_image is null or octet_length(share_image) between 1 and 524288),
  add column share_image_mime text check (share_image_mime in ('image/png', 'image/jpeg', 'image/webp')),
  add column tagline          text check (tagline is null or (length(trim(tagline)) > 0 and length(tagline) <= 120)),
  add column footer_text      text check (footer_text is null or (length(trim(footer_text)) > 0 and length(footer_text) <= 500)),
  add column whatsapp_number  text check (whatsapp_number ~ '^[1-9][0-9]{7,14}$'),
  add column whatsapp_label   text check (whatsapp_label is null or (length(trim(whatsapp_label)) > 0 and length(whatsapp_label) <= 40)),
  add column whatsapp_message text check (whatsapp_message is null or (length(trim(whatsapp_message)) > 0 and length(whatsapp_message) <= 300)),
  add constraint partner_brands_logo_dark_pair check ((logo_dark is null) = (logo_dark_mime is null)),
  add constraint partner_brands_favicon_pair check ((favicon is null) = (favicon_mime is null)),
  add constraint partner_brands_share_image_pair check ((share_image is null) = (share_image_mime is null)),
  -- Label and message only make sense with a number.
  add constraint partner_brands_whatsapp_number check (
    whatsapp_number is not null or (whatsapp_label is null and whatsapp_message is null)
  );
