# OMP 12 compatibility transcript

`omp12-session.jsonl` was generated on Bun 1.3.14 with the unmodified published `@oh-my-pi/pi-coding-agent@12.0.0` SessionManager and `@oh-my-pi/pi-utils@12.0.0`. It contains only local test messages; no inference request was made. The recorded managed working directory deliberately does not exist.

The coding-agent archive integrity is `sha512-TFRmbl500U7v5MqwSoFbEjQQnpcKWOj7qtmKKPSYoPZJvLEmc0/KDGxoGpkg+tcfeq+5oFmx8GoIexp54fkPlw==`; the utils archive integrity is `sha512-6GSIIE8Vw5+QuZOa55wOlZH1HbzcPUt4yG9fTkGrUw9soeycyf3MABPyeyCnHFakd/3RFlbeJI3p3VjYIPLP1Q==`. Writer dependencies were Ajv 8.17.1, Handlebars 4.7.8, Winston 3.19.0, winston-daily-rotate-file 5.0.0 and TypeBox 0.34.48.

Generation used `SessionManager.create('/removed/managed/astrid/version/a', outputDirectory)`, appended the user and assistant messages in the fixture, then called `await manager.setSessionFile(manager.getSessionFile())` to drain OMP 12's queued writes and `await manager.flush()`. The file was copied without modification.

The fixture SHA-256 is `d0a79b71c3a986389342eb3a469a6ba58bd6ea80154a6a73e676da538157c937`. Compatibility requires retaining its session ID, message history and selected store path. A producer format upgrade may rewrite transcript bytes during recovery.
