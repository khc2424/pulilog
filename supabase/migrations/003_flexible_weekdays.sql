-- Run this once to allow any weekday combination. Includes the change from 002.
-- No class, student, video, or learning records are removed.
begin;
alter table public.pl_classes drop constraint if exists pl_classes_schedule_check;
alter table public.pl_classes add constraint pl_classes_schedule_check
  check (schedule in ('','MWF','TTS','MW','TT')
    or schedule ~ '^days:[1-7](,[1-7]){0,6}$');
commit;
