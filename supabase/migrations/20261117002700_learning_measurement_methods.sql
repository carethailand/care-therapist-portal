-- (keep) Portal 027 – Learning Hub: one topic for measurement methods
--
-- Run AFTER 026. A-01 (continuous) and A-02 (discontinuous) become one topic,
-- "A-01 Measurement methods: continuous & discontinuous". Links and study logs
-- that were on A-02 move to A-01, and A-02 is hidden (not deleted).

begin;

update public.learning_topics
   set title = 'Measurement methods: continuous & discontinuous'
 where code = 'A-01';

update public.learning_resources   set topic_code = 'A-01' where topic_code = 'A-02';
update public.learning_reflections set topic_code = 'A-01' where topic_code = 'A-02';

update public.learning_topics set active = false where code = 'A-02';

commit;
