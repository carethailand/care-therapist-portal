-- (keep) Portal 070 – Intake report: diagnosis + further assessments
--
-- Run AFTER 069 (and the private 069b). Adds standard wording for two new parts of the intake
-- report builder (Q32):
--   * Background: a diagnosis sentence (diagnoses, by whom, where, when) or "no formal diagnosis yet".
--   * Recommendations: further assessments, each with a named test (e.g. IQ test: WISC-V).
-- Only TEMPLATE wording (generic assessment and test names): no child data. Admins and supervisors
-- can change all of it later in Reports & Forms -> Intake reports -> Edit template.
-- Safe to run again: existing wording is never overwritten.

insert into public.intake_wording (key, lang, body) values
  ('bg_diagnosis', 'en', '{name} was diagnosed with {diagnoses} by {doctor} of {place} in {when}.'),
  ('bg_diagnosis', 'th', '{name} ได้รับการวินิจฉัยว่ามีภาวะ {diagnoses} โดย {doctor} จาก{place} เมื่อ{when}'),
  ('bg_diagnosis_also', 'en', '{name} was also diagnosed with {diagnoses} by {doctor} of {place} in {when}.'),
  ('bg_diagnosis_also', 'th', 'นอกจากนี้ {name} ยังได้รับการวินิจฉัยว่ามีภาวะ {diagnoses} โดย {doctor} จาก{place} เมื่อ{when}'),
  ('bg_no_diagnosis', 'en', '{name} has not yet received a formal diagnosis.'),
  ('bg_no_diagnosis', 'th', '{name} ยังไม่ได้รับการวินิจฉัยอย่างเป็นทางการ'),
  ('rec_assess', 'en', 'Further Assessment: To better understand {name}''s needs, we recommend the following assessments:'),
  ('rec_assess', 'th', 'การประเมินเพิ่มเติม: เพื่อให้เข้าใจความต้องการของ{name} มากขึ้น แนะนำให้เข้ารับการประเมินเพิ่มเติม ดังนี้'),
  ('assess_list', 'en', 'IQ / cognitive test | แบบทดสอบระดับสติปัญญา (IQ) | WISC-V; WPPSI-IV; Stanford-Binet 5; Leiter-3
Autism diagnostic assessment | การประเมินเพื่อวินิจฉัยภาวะออทิซึม | ADOS-2; ADI-R; CARS-2
Developmental assessment | การประเมินพัฒนาการ | Bayley-4; Griffiths III; DSPM; DAIM
Developmental paediatrician review | พบกุมารแพทย์พัฒนาการและพฤติกรรม |
Child psychiatrist review | พบจิตแพทย์เด็กและวัยรุ่น |
ADHD assessment | การประเมินสมาธิสั้น (ADHD) | Conners 4; SNAP-IV; Vanderbilt
Speech and language assessment | การประเมินทักษะการพูดและภาษา | CELF-5; CELF Preschool-3; PLS-5
Occupational therapy assessment | การประเมินกิจกรรมบำบัด | Beery VMI; BOT-2; PDMS-2
Physical therapy assessment | การประเมินกายภาพบำบัด | PDMS-2; BOT-2; GMFM
Sensory processing assessment | การประเมินการประมวลผลประสาทสัมผัส | Sensory Profile 2; SPM-2
Hearing test | การตรวจการได้ยิน | Audiometry; OAE; ABR
Vision / eye exam | การตรวจตาและการมองเห็น |
Adaptive behaviour assessment | การประเมินทักษะการใช้ชีวิตประจำวัน | Vineland-3; ABAS-3
Learning / academic assessment | การประเมินทักษะการเรียนรู้ | WIAT-4; WJ IV; KTEA-3
Neurology review / EEG | พบประสาทแพทย์เด็ก / ตรวจคลื่นไฟฟ้าสมอง (EEG) | EEG
Genetic testing | การตรวจทางพันธุกรรม | Chromosomal microarray; Karyotype; Fragile X
Feeding / swallowing assessment | การประเมินการกินและการกลืน |
Sleep assessment | การประเมินการนอนหลับ | Sleep study (polysomnography)')
on conflict (key, lang) do nothing;

select key, lang, length(body) as chars from public.intake_wording
 where key in ('bg_diagnosis', 'bg_diagnosis_also', 'bg_no_diagnosis', 'rec_assess', 'assess_list') order by key, lang;
