-- Existing classes and students are preserved. Allow two-day class schedules.
begin;
alter table public.pl_classes drop constraint if exists pl_classes_schedule_check;
alter table public.pl_classes add constraint pl_classes_schedule_check
  check (schedule in ('','MWF','TTS','MW','TT'));
commit;
