BEGIN;

CREATE TYPE public.project_request_meeting_recommendation AS ENUM (
  'SCHEDULE_MEETING',
  'DO_NOT_SCHEDULE_MEETING'
);

-- Sin default ni backfill: las revisiones anteriores no expresaban esta decisión.
ALTER TABLE public.project_request_reviews
  ADD COLUMN meeting_recommendation public.project_request_meeting_recommendation;

COMMIT;
