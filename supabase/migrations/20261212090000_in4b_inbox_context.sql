-- ============================================================================
-- Migration: 20261212090000_in4b_inbox_context.sql
-- Module: IN4b — context, labels and notices of the Inbox
--         (docs/modules/inbox/plano-in4b-in6.md)
--
-- Maintenance Rationale:
-- 1. Message marks (shared with the IN6): the core records WHEN a message
--    arrived in a room and FROM WHOM (consumer, team or agent), never its
--    text, which stays on Synapse (ADR 0023, rule 6). `matrix_events`
--    accepts `m.room.message` with an empty content; `matrix_rooms` keeps
--    the last time of each side. The notice "no answer" (IN4b) and the
--    GUIDS's turn (IN6) read them.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Message marks
-- ----------------------------------------------------------------------------
alter table public.matrix_events drop constraint matrix_events_type_check;
alter table public.matrix_events
  add constraint matrix_events_type_check
  check (type in ('m.room.member', 'chat.guidu.conversation', 'm.room.message'));
-- A message is recorded without its body: only the kind of message.
alter table public.matrix_events
  add constraint matrix_events_message_without_body
  check (type <> 'm.room.message' or not (content ? 'body'));

alter table public.matrix_rooms
  add column last_consumer_message_at timestamptz,
  add column last_team_message_at timestamptz,
  add column last_agent_message_at timestamptz;
