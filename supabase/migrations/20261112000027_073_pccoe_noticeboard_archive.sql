-- Campus+ migration 073 — PCCOE noticeboard archive (batch pccoe-noticeboard-2026-11)
-- =============================================================================
-- Imports the 64 supplied noticeboard entries as archive records:
--
--   public.notices                 title and description exactly as supplied,
--                                  status = 'archived', published by the import
--                                  profile
--   public.notice_archive_entries  source key, section, organisation
--                                  attribution, source category, period and
--                                  source note where given, order, checksum
--
-- Nothing is written to public.events or public.academic_calendar: no entry in
-- the batch carries a date or a venue, and both tables require them. No
-- organisation is created; a section is linked to a club only when that club
-- already exists in the catalogue, and is otherwise attributed by name.
--
-- The descriptions are written summaries of noticeboard displays, not
-- transcriptions of the posters. They are stored exactly as supplied: every
-- section and entry carries a digest of its own fields, and the import refuses
-- to run if any of them no longer matches.
--
-- Re-running is safe. A source key that is already registered is skipped, so
-- an existing record is never duplicated or overwritten, including one that
-- staff have since edited or deleted.
--
-- notices.created_by must reference a real profile, so the import needs the
-- publisher profile below. In a database without it (a fresh local or CI
-- database) the import says so and writes nothing.
-- =============================================================================

do $import$
declare
  c_batch        constant text := 'pccoe-noticeboard-2026-11';
  c_publisher    constant uuid := 'fc79f76a-3355-4788-bbf8-3e6d529ff957';

  -- Sections in display order, each with its entries in display order.
  --   attribution      'organization' (a student body or cell) or 'institution'
  --   match_keys       compared with communities.catalogue_key and slug
  --   match_names      compared with the lower-cased club name and aliases
  --   source_category  the wording of the source
  --   category         the nearest notice_category value
  --   period           the year the entry's own text gives, where it gives one
  --   note             what the source did not preserve, where it says so
  --   digest           md5 of the fields, joined by chr(31):
  --                      section  key, label, organization, attribution,
  --                               keys, names (each '|'-joined)
  --                      entry    section key, slug, title, source_category,
  --                               category, period, note, body ('' when absent)
  c_manifest     constant jsonb := $json$[
    {"key":"itsa","label":"ITSA — Information Technology Student Association","organization":"ITSA","attribution":"organization","match_keys":["itsa"],"match_names":["itsa","information technology student association","information technology students association"],"digest":"5ed88bdf75c7b26b759cb43f7e8532b7",
     "entries":[
      {"slug":"ai-workshop","title":"AI Workshop","source_category":"Technical / Workshop","category":"event","digest":"d51795a3621734bf4c316b600bea9a39",
       "body":"An ITSA learning initiative focused on Artificial Intelligence and its growing role in technology. The workshop introduces students to the field of AI, its fundamental concepts and its relevance to modern computing. It provides an opportunity for students to develop awareness of AI and explore its applications."},
      {"slug":"induction-25","title":"Induction '25","source_category":"Club / Cultural","category":"event","period":"2025","digest":"80a5cd6588b6d93ec3abbe310cc85b45",
       "body":"The ITSA induction programme for the 2025 student intake. An introductory initiative intended to welcome students into the Information Technology student community, familiarise them with the association and introduce the activities, participation opportunities and student engagement associated with ITSA."},
      {"slug":"techpulse-2k25","title":"TechPulse-2K25","source_category":"Technical","category":"event","period":"2025","digest":"3827796f50f8fb749551277bb84a1f1f",
       "body":"A named ITSA technical programme from 2025, included in the association's campus activity archive. Preserve the original title and present it as part of ITSA's record of student-focused technical activities and engagement."},
      {"slug":"techroom-2-0","title":"TechRoom 2.0","source_category":"Technical / Workshop","category":"event","digest":"4c7ed1e9ce00ed67e7508d797fdc37c9",
       "body":"The second-edition TechRoom programme associated with ITSA. It forms part of the association's technical activity and student learning initiatives, providing a space for students to engage with technology-focused activities and knowledge sharing."},
      {"slug":"teachers-day","title":"Teacher's Day","source_category":"Cultural","category":"event","digest":"d00d2723c46bb88e0b1a65bbcc554cf4",
       "body":"An ITSA-organised Teacher's Day celebration recognising the contribution of faculty members to student learning and development. The programme represents a student-led gesture of appreciation and respect for teachers."},
      {"slug":"swc-meditation","title":"SWC Meditation","source_category":"Other","category":"general","digest":"c1a6b8f442ec5bb622c4181043a2ea3b",
       "body":"A meditation and well-being activity identified under the title SWC Meditation. The initiative focuses on encouraging mindfulness, mental relaxation and personal well-being among students through meditation-related engagement. Retain the abbreviation SWC without expanding it."},
      {"slug":"abhidnya-2-0-bruteforge","title":"Abhidnya 2.0 Bruteforge","source_category":"Technical","category":"event","digest":"e2764f25f54a4e3a45c941f554d120d6",
       "body":"An ITSA programme identified by the title Abhidnya 2.0 Bruteforge. Preserve the complete event name as an entry in the technical and student activity archive. Do not assume a specific competition format, programming language, cybersecurity theme or challenge structure that has not been established."},
      {"slug":"akshardhara","title":"Akshardhara","source_category":"Cultural","category":"event","digest":"86b751ee628563220d262451e81a1c0a",
       "body":"An ITSA-associated student programme titled Akshardhara. Preserve it as part of the association's cultural and student activity record, with the original event name retained. Do not invent its exact format or schedule."},
      {"slug":"praxis","title":"PRAXIS","source_category":"Technical / Other","category":"event","digest":"cceac265759596afe62fe1e392c9ae4d",
       "body":"PRAXIS is an event title identified on the ITSA noticeboard. Include it in the ITSA activity archive as a named programme. The year and specific event format are not established, so do not add a fabricated edition, date or description of activities."},
      {"slug":"innoveda-24","title":"INNOVEDA '24","source_category":"Technical / Other","category":"event","period":"2024","digest":"4f568982550cf58f1120c561cc0ad0f6",
       "body":"An ITSA programme identified by the title INNOVEDA '24. Preserve its 2024 edition reference and include it in the association's historical record of student activities and innovation-oriented programmes."},
      {"slug":"farewell-25","title":"Farewell '25","source_category":"Cultural","category":"event","period":"2025","digest":"c68432bd6f5acae311d08d424dbce023",
       "body":"The ITSA farewell programme associated with the 2025 batch. A student community event recognising outgoing students and marking their transition from the institution, while celebrating their association with the department and student community."},
      {"slug":"induction-24","title":"Induction '24","source_category":"Club / Cultural","category":"event","period":"2024","digest":"8b2b64a9bbefd45afdc3d8c77056705e",
       "body":"The ITSA induction programme associated with the 2024 student intake. An introductory student-community initiative intended to welcome new students and familiarise them with ITSA, its activities and opportunities for student participation."}
    ]},
    {"key":"mlsc","label":"MLSC — Microsoft Learn Student Community","organization":"MLSC","attribution":"organization","match_keys":["mlsc","mlsc-pccoe"],"match_names":["mlsc","mlsc pccoe","microsoft learn student community","microsoft learn student club","microsoft learn student chapter"],"digest":"983a37020548791e838cb87c89a0e7ad",
     "entries":[
      {"slug":"datathon","title":"Datathon","source_category":"Technical","category":"event","digest":"78dd951b34fa7867e25110d4006cb8c9",
       "body":"A data-focused student activity centred on working with data, analytical thinking and problem-solving. The programme provides an opportunity for students to explore data-oriented challenges and develop their understanding of data-driven technology."},
      {"slug":"miniscape","title":"Miniscape","source_category":"Technical / Other","category":"event","digest":"6b96c72f28266724893ef0084ec88a08",
       "body":"A named MLSC student programme identified on the noticeboard. Preserve the title Miniscape and include it in the community's activity archive as a distinct programme. Do not invent its technical theme, format or competition structure."},
      {"slug":"bluebit-4-0","title":"BlueBit 4.0","source_category":"Technical","category":"event","digest":"c5707361fe2cd026653d9dbd5450af61",
       "body":"The fourth-edition BlueBit programme associated with MLSC. Preserve the edition number and original title as part of the community's technical activity history. Present it as a student-focused technology programme without inventing its specific agenda or competition format."},
      {"slug":"techroom","title":"TechRoom","source_category":"Technical / Workshop","category":"event","digest":"bfa1526dd94ed940e72eea6d3f1454cc",
       "body":"An MLSC technical activity focused on student engagement with technology and computing. Include the programme in the community's activity archive as a technical learning and engagement initiative."},
      {"slug":"project-development","title":"Project Development","source_category":"Technical","category":"event","digest":"e937467f27b15e26fdfb176074417880",
       "body":"A project-development initiative encouraging students to work on ideas, build practical solutions and engage in collaborative technical development. It represents hands-on learning and the application of computing concepts through student projects."},
      {"slug":"problemathon","title":"Problemathon","source_category":"Technical","category":"event","digest":"0c66db271928ecb829d9832ee368b7d2",
       "body":"A problem-solving-oriented MLSC programme encouraging students to approach challenges through structured thinking and technical reasoning. Preserve its original title and present it as part of the community's student technical activities."},
      {"slug":"aiquest","title":"AIQuest","source_category":"Technical / Workshop","category":"event","digest":"de79454ee4fbfafff26733a26bc88074",
       "body":"An Artificial Intelligence-focused MLSC programme intended to promote student engagement with AI-related concepts and technology. Include it in the community's AI and technical activity archive."},
      {"slug":"ai-canvas","title":"AI Canvas","source_category":"Technical / Workshop","category":"event","digest":"e31c5b0ad557ea194e946c98b7c43513",
       "body":"An MLSC initiative centred on Artificial Intelligence and creative exploration. The programme represents an opportunity for students to engage with AI-related ideas and explore the intersection of technology and creativity."},
      {"slug":"recurring-mlsc-sessions","title":"Recurring MLSC Sessions","source_category":"Technical / Workshop","category":"event","digest":"d13f8a0387b6a5d117d7aaa0778499f9",
       "body":"A recurring series of Microsoft Learn Student Community learning and engagement sessions. These activities form part of the community's ongoing effort to encourage technical learning, knowledge sharing and student participation.",
       "note":"Individual session dates, speakers and agendas are not recorded for this series."}
    ]},
    {"key":"ieee","label":"IEEE — Student Chapter","organization":"IEEE Student Chapter","attribution":"organization","match_keys":["ieee","ieee-pccoe"],"match_names":["ieee","ieee pccoe","ieee student chapter","ieee student branch","pccoe ieee student chapter","pccoe ieee student branch"],"digest":"2efcafd61757e7328e1bc06f5319c345",
     "entries":[
      {"slug":"invent-pitch","title":"Invent Pitch","source_category":"Technical","category":"event","digest":"2c56dfe1edfe5af0666c38ef1cd6a3ca",
       "body":"An IEEE student initiative centred on presenting and communicating innovative ideas. The programme encourages participants to articulate concepts, explain potential solutions and engage in idea-oriented technical discussions."},
      {"slug":"membership-drive","title":"Membership Drive","source_category":"Club / Opportunity","category":"opportunity","digest":"66259b59388db223696438a36b04980a",
       "body":"An IEEE student chapter membership initiative inviting students to learn about the chapter, its activities and opportunities for participation. The programme serves as an introduction to the IEEE student community and its technical and professional engagement."},
      {"slug":"iot-workshop","title":"IoT Workshop","source_category":"Technical / Workshop","category":"event","digest":"ad51f290e603a8829d334a46112de491",
       "body":"A technical workshop focused on the Internet of Things (IoT), an area involving connected devices and communication between physical systems. The activity introduces students to the IoT domain and its significance in modern technological applications."},
      {"slug":"resume-building-interview-skills","title":"Resume Building / Interview Skills","source_category":"Opportunity / Workshop","category":"opportunity","digest":"22266ad1ddbb1f8c6f98d4f4d52397c6",
       "body":"A professional development initiative focused on preparing students for internships, placements and career opportunities. The programme covers resume preparation and interview readiness, encouraging students to communicate their skills and present themselves effectively in professional settings."},
      {"slug":"ieee-awards-and-achievements","title":"IEEE Awards and Achievements","source_category":"General / Achievement","category":"general","digest":"60c188155228613a637d4f6984b95ace",
       "body":"A record of IEEE-related awards and achievements displayed on the student chapter noticeboard. Preserve the existence of these accomplishments as part of the chapter's institutional activity history. Do not invent award names, recipient identities, rankings or years."}
    ]},
    {"key":"higher-studies","label":"Higher Studies & Competitive Exams Cell","organization":"Higher Studies & Competitive Exams Cell","attribution":"organization","match_keys":["higher-studies","higher-studies-cell","higher-studies-and-competitive-exams-cell"],"match_names":["higher studies & competitive exams cell","higher studies and competitive exams cell","higher studies cell"],"digest":"636d84689f0efcc0bde4eadb98e529ee",
     "entries":[
      {"slug":"gre-readiness","title":"GRE Readiness","source_category":"Opportunity / Academic","category":"opportunity","digest":"8cd9ee15babbe85c966a153ad1a5de0a",
       "body":"A higher-studies preparation initiative focused on helping students understand and prepare for the Graduate Record Examination (GRE). The activity represents institutional support for students considering postgraduate education and international academic opportunities."},
      {"slug":"mock-gate","title":"Mock GATE","source_category":"Academic / Opportunity","category":"academic","digest":"1160d9da5bef67f100f05ec61056a7a4",
       "body":"A Graduate Aptitude Test in Engineering (GATE) preparation activity involving mock examination practice. The initiative encourages students to assess their preparation, become familiar with competitive examination expectations and identify areas requiring further study."},
      {"slug":"higher-education-lecture-on-ai","title":"Higher Education Lecture on AI","source_category":"Academic / Workshop","category":"academic","digest":"9f1229ed527fa32dbddb91b3b322222f",
       "body":"An academic session addressing higher education opportunities and the field of Artificial Intelligence. The programme is intended to inform students about further academic pathways and the relevance of AI in advanced study."},
      {"slug":"alumni-information","title":"Alumni Information","source_category":"Academic / Opportunity","category":"academic","digest":"3bd3160c4880a2bc12569eec350dfb43",
       "body":"An institutional information display highlighting alumni-related information and higher education pathways. Preserve it as a source of academic and career guidance for current students. Do not invent alumni names, institutions, degrees or contact information."}
    ]},
    {"key":"nss-isr","label":"NSS / ISR — Social Responsibility Activities","organization":"NSS / ISR","attribution":"organization","match_keys":["nss","isr","nss-isr","nss-pccoe"],"match_names":["nss","isr","nss / isr","nss/isr","national service scheme"],"digest":"1b19785882bbfcaef62f2a98c6c60c0d",
     "entries":[
      {"slug":"campus-and-environmental-drives","title":"Campus and Environmental Drives","source_category":"Social","category":"general","digest":"480fbc80707308717b0b19f4fdef4d8b",
       "body":"A collection of student-led initiatives focused on campus cleanliness, environmental awareness and responsible participation in maintaining the institutional surroundings. These activities encourage students to contribute to a cleaner and more environmentally conscious campus."},
      {"slug":"donation-initiatives","title":"Donation Initiatives","source_category":"Social","category":"general","digest":"980d5edae7da298cc94d30daaece91e8",
       "body":"Social responsibility initiatives involving donation and community support activities. These programmes represent student participation in helping others and contributing to community-oriented causes."},
      {"slug":"e-waste-collection","title":"E-Waste Collection","source_category":"Social","category":"general","digest":"0183e9d2e71a9f66a52430a0fef3e954",
       "body":"An environmental awareness initiative focused on responsible collection and disposal of electronic waste. The activity highlights the importance of reducing improper e-waste disposal and encouraging environmentally responsible practices."},
      {"slug":"energy-conservation","title":"Energy Conservation","source_category":"Social","category":"general","digest":"1d58254b7517a099147573ecb7f780cb",
       "body":"An awareness initiative promoting energy conservation and responsible energy usage. The activity encourages students to recognise the importance of reducing unnecessary consumption and supporting sustainable practices."},
      {"slug":"waste-segregation","title":"Waste Segregation","source_category":"Social","category":"general","digest":"3e5eacd546032635a673134f54fada15",
       "body":"An environmental initiative encouraging proper segregation of waste and responsible disposal practices. The programme promotes awareness of waste management and the role students can play in maintaining a cleaner environment."},
      {"slug":"road-safety-awareness","title":"Road Safety Awareness","source_category":"Social","category":"general","digest":"f5e590da669822df6192941d8aa564fe",
       "body":"A student awareness initiative focused on road safety and responsible behaviour on public roads. The activity promotes awareness of safe practices and the importance of individual responsibility in preventing road accidents."},
      {"slug":"anti-drug-awareness","title":"Anti-Drug Awareness","source_category":"Social","category":"general","digest":"86eaf1a37e1138cc75eec931acf362cb",
       "body":"An awareness initiative addressing the risks associated with drug use and encouraging informed, responsible and healthy choices among students. The programme forms part of the institution's social awareness and student well-being activities."}
    ]},
    {"key":"entrepreneurship-innovation","label":"Entrepreneurship & Innovation Cell","organization":"Entrepreneurship & Innovation Cell","attribution":"organization","match_keys":["entrepreneurship-innovation-cell","entrepreneurship-and-innovation-cell","e-and-i-cell"],"match_names":["entrepreneurship & innovation cell","entrepreneurship and innovation cell","e&i cell"],"digest":"5681de65abe08d3f98434e8f6af88dc7",
     "entries":[
      {"slug":"expert-talks","title":"Expert Talks","source_category":"Opportunity / Workshop","category":"opportunity","digest":"85d6f55f5dbe02381b5cf6660c09d359",
       "body":"A series of expert-led knowledge-sharing activities intended to expose students to practical perspectives on innovation, entrepreneurship and industry-related subjects. These sessions connect academic learning with broader professional and entrepreneurial thinking."},
      {"slug":"entrepreneurship-sessions","title":"Entrepreneurship Sessions","source_category":"Opportunity / Workshop","category":"opportunity","digest":"b6e6cbf252487fa59137bc9a6cb387ae",
       "body":"Student learning sessions focused on entrepreneurship, idea development and the process of building ventures. The activities encourage participants to understand how ideas can be evaluated and developed into meaningful projects or business initiatives."},
      {"slug":"intellectual-property-awareness","title":"Intellectual Property Awareness","source_category":"Academic / Opportunity","category":"academic","digest":"57fb72864c573b7b2c051d45dff5b938",
       "body":"An awareness initiative introducing students to Intellectual Property (IP) and its importance in protecting original ideas, inventions and creative work. The activity encourages students to understand the role of intellectual property in innovation and entrepreneurship."},
      {"slug":"technology-readiness-level-trl-sessions","title":"Technology Readiness Level (TRL) Sessions","source_category":"Technical / Workshop","category":"event","digest":"59e2b2e53915fd3090b3803695724d3c",
       "body":"An educational initiative covering Technology Readiness Levels (TRL) and how technological ideas progress through stages of development and maturity. The sessions help students understand how to assess the readiness of a technology or innovation."},
      {"slug":"investment-related-sessions","title":"Investment-Related Sessions","source_category":"Opportunity / Workshop","category":"opportunity","digest":"4b94ad2a26a97d354457f677fad5e93f",
       "body":"Entrepreneurship and innovation sessions introducing students to investment concepts and the financial considerations involved in developing ventures. The activities promote awareness of how projects and early-stage ideas may seek financial support."},
      {"slug":"crowdfunding-awareness","title":"Crowdfunding Awareness","source_category":"Opportunity","category":"opportunity","digest":"3305c518434e1b3d076e6661622affa3",
       "body":"An awareness initiative focused on crowdfunding as a way of raising financial support for projects and entrepreneurial ideas. The activity introduces students to the concept of collective funding and its relevance to innovation and venture development."},
      {"slug":"ai-related-webinars","title":"AI-Related Webinars","source_category":"Technical / Workshop","category":"event","digest":"185034c7c0121784b0691a7c0fcc2a12",
       "body":"A series of webinars addressing Artificial Intelligence and its relevance to emerging technology and innovation. These sessions form part of the cell's broader knowledge-sharing activities and encourage students to explore developments in AI."}
    ]},
    {"key":"art-circle","label":"Art Circle","organization":"Art Circle","attribution":"organization","match_keys":["art-circle","art-circle-pccoe"],"match_names":["art circle","pccoe art circle"],"digest":"87ae325b6d15ea425340e07a4d19d3ff",
     "entries":[
      {"slug":"firodiya-karandak-2024","title":"Firodiya Karandak 2024","source_category":"Cultural","category":"event","period":"2024","digest":"4c629ddb9ca77634c50e5987c0b54f1e",
       "body":"The 2024 Firodiya Karandak entry in the Art Circle's cultural activity archive. Preserve the edition year and programme name as part of the institution's record of student cultural participation and creative performance activities."},
      {"slug":"firodiya-karandak-2026","title":"Firodiya Karandak 2026","source_category":"Cultural","category":"event","period":"2026","digest":"a49fce300aedda84e8a05f10094bfa90",
       "body":"The 2026 Firodiya Karandak entry in the Art Circle's cultural activity archive. Preserve this edition separately from the 2024 entry, documenting it as a distinct year of student cultural participation."},
      {"slug":"vinodattam","title":"Vinodattam","source_category":"Cultural","category":"event","digest":"c2f21cef695e05abc3ac7330b091ce7e",
       "body":"A named Art Circle cultural programme identified on the noticeboard. Preserve the original title and include it in the institution's cultural activity archive as a student creative and cultural initiative."},
      {"slug":"dhc-4","title":"DHC-4","source_category":"Cultural","category":"event","digest":"d6fa29f8dbb28d45a2ae0f8315437577",
       "body":"A named Art Circle programme identified by the title DHC-4. Preserve the original title exactly and include it as a separate entry in the cultural activity archive. Do not expand the acronym or invent its format."},
      {"slug":"akshardhara","title":"Akshardhara","source_category":"Cultural","category":"event","digest":"f3e96c03b8f3e9cae963a8a41223d083",
       "body":"An Art Circle programme identified by the title Akshardhara. Preserve it as a distinct cultural activity and include it in the institution's record of student creative and cultural engagement."},
      {"slug":"social-activity-workshop","title":"Social Activity Workshop","source_category":"Cultural / Social","category":"event","digest":"c32a6c607c32634e8cc86d6a8990fcf0",
       "body":"A workshop-oriented activity combining student participation with social engagement. The programme represents an opportunity for students to take part in organised activities that encourage community involvement and creative participation."},
      {"slug":"diya-painting","title":"Diya Painting","source_category":"Cultural / Arts","category":"event","digest":"cc49b875a26400adba58bd644b098d7c",
       "body":"A creative activity centred on diya painting and artistic expression. The programme offers students an opportunity to engage in decorative art and participate in a hands-on cultural activity."},
      {"slug":"digital-poster-drawing-competition","title":"Digital Poster / Drawing Competition","source_category":"Arts / Cultural","category":"event","digest":"d0479b994b4be881d4d8482aad952c5b",
       "body":"A creative competition encouraging students to express ideas through digital poster design and drawing. The activity highlights visual creativity, artistic communication and student participation in design-oriented competitions."},
      {"slug":"kavi-sammelan","title":"Kavi Sammelan","source_category":"Cultural / Arts","category":"event","digest":"6071726f7f36a523a95e1ba32ee54774",
       "body":"A literary and poetry-focused gathering providing a platform for poetic expression and appreciation of language and literature. The programme represents the creative and literary side of student cultural participation."},
      {"slug":"swartarang","title":"Swartarang","source_category":"Cultural","category":"event","digest":"83aee0cf86e2012188d84938b027fa1c",
       "body":"An Art Circle cultural programme identified by the title Swartarang. Preserve the original name and include it in the cultural activity archive as a distinct student creative programme. Do not invent performers, performances or schedule details."}
    ]},
    {"key":"sports","label":"Sports Achievements","organization":"PCCOE","attribution":"institution","match_keys":[],"match_names":[],"digest":"54ff00263ceac6acde1ac80a91cc4d07",
     "entries":[
      {"slug":"sports-achievements","title":"Sports Achievements","source_category":"Sports / Achievement","category":"general","digest":"31dc7b96e7fbb651bbde9978d09801ee",
       "body":"The PCCOE sports noticeboard featured student sports achievements, recognising participation and accomplishments in sporting activities. This category preserves the presence of sports-related recognition in the institutional noticeboard archive.",
       "note":"Individual sports, athlete names, achievements, rankings and years were not preserved in the extracted inventory."}
    ]},
    {"key":"alphabyte-hackathon","label":"Alphabyte Hackathon Achievement","organization":"PCCOE","attribution":"institution","match_keys":[],"match_names":[],"digest":"e5a6fc9dcf5aacfe9f52a3f44fd4bc8f",
     "entries":[
      {"slug":"alphabyte-hackathon-student-achievement","title":"Alphabyte Hackathon — Student Achievement","source_category":"Technical / Achievement","category":"general","digest":"21183bf82fae502b49a20bcc9ddc90d4",
       "body":"A student hackathon achievement identified on the PCCOE noticeboards. The Alphabyte Hackathon win represents a technical accomplishment and student participation in competitive innovation and problem-solving. Preserve it as an institutional achievement.",
       "note":"The team name, participants, exact position, project title and year are not available in the extracted information."}
    ]},
    {"key":"placement","label":"Placement Statistics Archive","organization":"PCCOE","attribution":"institution","match_keys":[],"match_names":[],"digest":"67d59f63d80b8046ab3ba5f83cfa56a8",
     "entries":[
      {"slug":"placement-overview-ay-2022-23","title":"Placement Overview — AY 2022–23","source_category":"Placement / Academic","category":"academic","period":"AY 2022–23","digest":"edf9188e78f4e47db92ae3cf3fb5f9de",
       "body":"Institutional placement information displayed for the academic year 2022–23. Preserve this as a historical placement-statistics record in the Campus+ institutional information archive.",
       "note":"Exact numerical statistics were not retained. This entry is not a numerical placement report."},
      {"slug":"placement-overview-ay-2023-24","title":"Placement Overview — AY 2023–24","source_category":"Placement / Academic","category":"academic","period":"AY 2023–24","digest":"94cf3baf9df8ce076862ce7fd17b52db",
       "body":"Institutional placement information displayed for the academic year 2023–24. Preserve this as a separate historical placement-statistics record.",
       "note":"Exact numerical statistics were not retained. This entry is not a numerical placement report."},
      {"slug":"placement-overview-ay-2024-25","title":"Placement Overview — AY 2024–25","source_category":"Placement / Academic","category":"academic","period":"AY 2024–25","digest":"b4b01ed14cc588e296f6c280536f30e1",
       "body":"Institutional placement information displayed for the academic year 2024–25. Preserve this as a separate historical placement-statistics record.",
       "note":"Exact numerical statistics were not retained. This entry is not a numerical placement report."},
      {"slug":"placement-overview-ay-2025-26","title":"Placement Overview — AY 2025–26","source_category":"Placement / Academic","category":"academic","period":"AY 2025–26","digest":"24a173b2bd29b6a8d382849b9e7269cf",
       "body":"Institutional placement information displayed for the academic year 2025–26. Preserve this as a separate placement-statistics record.",
       "note":"Exact numerical statistics were not retained. This entry is not a numerical placement report."}
    ]},
    {"key":"departmental","label":"Departmental Academic Displays","organization":"PCCOE","attribution":"institution","match_keys":[],"match_names":[],"digest":"8c67040e7b92014aef32dd0fc735c331",
     "entries":[
      {"slug":"teaching-and-learning-activities","title":"Teaching and Learning Activities","source_category":"Academic","category":"academic","digest":"93541e90d08084b9d50de5a1ec2224f7",
       "body":"A record of departmental teaching and learning activities displayed on the institutional noticeboards. This category captures academic initiatives and learning-related activities that form part of the department's educational environment."},
      {"slug":"student-projects","title":"Student Projects","source_category":"Academic","category":"academic","digest":"bc8a1192ec7c8f187ece0ae8b7ce1470",
       "body":"A collection of departmental student project displays highlighting project-based learning and student engagement with practical academic work. Preserve the category as institutional academic information without fabricating project names or authors."},
      {"slug":"pedagogy-and-academic-practices","title":"Pedagogy and Academic Practices","source_category":"Academic","category":"academic","digest":"d0659eb0eaafd521c0f557c6953767d1",
       "body":"Departmental information concerning teaching approaches, pedagogy and academic practices. This entry represents the academic initiatives and educational methods presented through the departmental displays."},
      {"slug":"departmental-academic-showcase","title":"Departmental Academic Showcase","source_category":"Academic","category":"academic","digest":"315d732981920d3757a9b416a31a2705",
       "body":"A general archive entry for departmental academic displays and educational information presented on the noticeboards. Preserve it as an institutional information category rather than inventing individual programmes."}
    ]}
  ]$json$;

  v_section      record;
  v_entry        record;
  v_sections     integer;
  v_entries      integer;
  v_keys         integer;
  v_problem      text;
  v_key          text;
  v_notice_id    uuid;
  v_community_id uuid;
  v_imported     integer := 0;
  v_present      integer := 0;
begin
  -- The whole manifest is checked before anything is written.
  select string_agg(s.value ->> 'key', ', ' order by s.ordinality)
    into v_problem
  from jsonb_array_elements(c_manifest) with ordinality as s(value, ordinality)
  where md5(concat_ws(chr(31),
          s.value ->> 'key', s.value ->> 'label', s.value ->> 'organization', s.value ->> 'attribution',
          array_to_string(array(select jsonb_array_elements_text(s.value -> 'match_keys')), '|'),
          array_to_string(array(select jsonb_array_elements_text(s.value -> 'match_names')), '|')
        )) is distinct from s.value ->> 'digest';
  if v_problem is not null then
    raise exception 'Noticeboard archive section does not match its digest: %', v_problem;
  end if;

  select
    count(distinct s.value ->> 'key'),
    count(*),
    count(distinct (s.value ->> 'key') || '/' || (e.value ->> 'slug')),
    string_agg((s.value ->> 'key') || '/' || (e.value ->> 'slug'), ', ' order by s.ordinality, e.ordinality)
      filter (where md5(concat_ws(chr(31),
                s.value ->> 'key', e.value ->> 'slug', e.value ->> 'title',
                e.value ->> 'source_category', e.value ->> 'category',
                coalesce(e.value ->> 'period', ''), coalesce(e.value ->> 'note', ''), e.value ->> 'body'
              )) is distinct from e.value ->> 'digest')
    into v_sections, v_entries, v_keys, v_problem
  from jsonb_array_elements(c_manifest) with ordinality as s(value, ordinality)
  cross join lateral jsonb_array_elements(s.value -> 'entries') with ordinality as e(value, ordinality);
  if v_problem is not null then
    raise exception 'Noticeboard archive entry does not match its digest: %', v_problem;
  end if;
  if jsonb_array_length(c_manifest) <> 11 or v_sections <> 11 or v_entries <> 64 or v_keys <> 64 then
    raise exception 'The noticeboard archive manifest must hold 11 sections and 64 uniquely keyed entries.';
  end if;

  if not exists (select 1 from public.profiles where id = c_publisher) then
    raise notice 'Noticeboard archive % not imported: publisher profile % does not exist in this database.',
      c_batch, c_publisher;
    return;
  end if;

  for v_section in
    select
      s.ordinality as section_order,
      s.value ->> 'key' as key,
      s.value ->> 'label' as label,
      s.value ->> 'organization' as organization,
      s.value ->> 'attribution' as attribution,
      array(select jsonb_array_elements_text(s.value -> 'match_keys')) as match_keys,
      array(select jsonb_array_elements_text(s.value -> 'match_names')) as match_names,
      s.value -> 'entries' as entries
    from jsonb_array_elements(c_manifest) with ordinality as s(value, ordinality)
    order by s.ordinality
  loop
    -- Link the section to an organisation only on one unambiguous match in the
    -- official club catalogue. No match, or more than one, leaves the entries
    -- attributed by name; an organisation is never created here. Sections
    -- attributed to the institution are never linked to a club.
    select case when count(*) = 1 then (array_agg(c.id))[1] end
      into v_community_id
    from public.communities c
    where v_section.attribution = 'organization'
      and c.kind = 'club'
      and c.status = 'published'
      and (
        c.catalogue_key = any (v_section.match_keys)
        or c.slug = any (v_section.match_keys)
        or lower(btrim(c.name)) = any (v_section.match_names)
        or exists (
          select 1
          from unnest(string_to_array(lower(coalesce(c.directory_aliases, '')), ',')) as alias(value)
          where btrim(alias.value) = any (v_section.match_names)
        )
      );

    for v_entry in
      select x.*
      from jsonb_array_elements(v_section.entries) with ordinality as e(value, ordinality)
      cross join lateral jsonb_to_record(e.value) as x(
        slug text, title text, source_category text, category text, period text, note text, body text
      )
      order by e.ordinality
    loop
      v_key := c_batch || '/' || v_section.key || '/' || v_entry.slug;

      if exists (select 1 from public.notice_archive_entries where source_key = v_key) then
        v_present := v_present + 1;
        continue;
      end if;

      insert into public.notices (title, body, category, importance, pinned, status, created_by)
      values (
        v_entry.title, v_entry.body, v_entry.category::public.notice_category,
        'normal', false, 'archived', c_publisher
      )
      returning id into v_notice_id;

      -- sort_order is the position of the entry in the manifest, 1 to 64.
      insert into public.notice_archive_entries (
        source_key, notice_id, section_key, section_label, organization, attribution, community_id,
        source_category, period, source_note, sort_order, source_checksum
      ) values (
        v_key, v_notice_id, v_section.key, v_section.label, v_section.organization, v_section.attribution,
        v_community_id, v_entry.source_category, v_entry.period, v_entry.note,
        v_imported + v_present + 1, md5(v_entry.title || chr(10) || v_entry.body)
      );

      v_imported := v_imported + 1;
    end loop;
  end loop;

  if (
    select count(*) from public.notice_archive_entries
    where source_key like c_batch || '/%'
  ) <> 64 then
    raise exception 'Noticeboard archive % must register exactly 64 source keys.', c_batch;
  end if;

  raise notice 'Noticeboard archive %: % imported, % already registered.', c_batch, v_imported, v_present;
end
$import$;
