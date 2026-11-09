# Codexa (MERN modular monolith)

Codexa is an AI-powered coding and algorithm learning platform. **Think. Trace. Transform.** Users practice problems, write code in the browser, and get verdicts for C++, Python, and Java. Its tutor guides learners toward their own solutions instead of giving answers away. Live algorithm visualizations are planned as a future differentiator.

Design: [`docs/HLD.md`](docs/HLD.md). Scope, rules, and build order: [`CLAUDE.md`](CLAUDE.md).

**Status: M7 AI tutor implemented.** Auth, problem APIs, the judge workflow, and the workspace tutor are connected; Docker-backed judge validation still requires a Docker-enabled host.

## Architecture (current)

```
Browser (React + Vite)
   | same-origin /api proxy
   |
   v
Express API (server/src/server.js -> app.js createApp())
   helmet, CORS allow-list, JSON body limit, cookie-parser, pino request logs
   /healthz, /api/auth, /api/problems, /api/submissions, /api/ai
   central error handler -> { ok:false, error:{ code, message } }
   |
   v
MongoDB
   collections: users, refreshTokens, problems, testcases,
                submissions, jobs, aiConversations

Separate judge worker -> MongoDB leased queue -> Docker sandbox (no network)
```

## Prerequisites

- Node.js >= 20.19 or >= 22.12 (required by the frontend toolchain)
- A MongoDB instance (local `mongod`, Docker, or MongoDB Atlas)
- Docker Engine/Desktop only when running the real judge worker

Redis and an LLM key are not required to run the web app. The tutor uses a deterministic mock by default; configure a hosted LLM provider to enable model-generated replies. Docker is needed only for real submitted-code execution.

## Setup

```bash
cd oj
npm install
cp .env.example .env
# edit .env: set MONGODB_URI and JWT_ACCESS_SECRET
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"   # a good secret
```

## Environment variables

| Name                         | Required    | Default                 | Description                                                                                  |
| ---------------------------- | ----------- | ----------------------- | -------------------------------------------------------------------------------------------- |
| `NODE_ENV`                   | no          | `development`           | `development`, `test`, or `production`. Production sets the `Secure` cookie flag.            |
| `PORT`                       | no          | `4000`                  | API port                                                                                     |
| `HOST`                       | no          | `0.0.0.0`               | Address for the API listener; set `127.0.0.1` when Nginx runs on the same host               |
| `LOG_LEVEL`                  | no          | `info`                  | pino level (`fatal` to `trace`, or `silent`)                                                 |
| `MONGODB_URI`                | **yes**     | none                    | `mongodb://` or `mongodb+srv://` connection string                                           |
| `DNS_SERVERS`                | no          | system DNS              | Optional comma-separated DNS resolver IPs; useful when Node cannot resolve Atlas SRV records |
| `JWT_ACCESS_SECRET`          | **yes**     | none                    | HS256 secret for access tokens, at least 32 characters                                       |
| `JWT_ACCESS_TTL_SEC`         | no          | `900`                   | Access token lifetime (15 min)                                                               |
| `REFRESH_TOKEN_TTL_DAYS`     | no          | `14`                    | Refresh token lifetime                                                                       |
| `CORS_ORIGINS`               | no          | `http://localhost:5173` | Comma-separated browser origins allowed to call the API                                      |
| `AUTH_RATE_LIMIT_MAX`        | no          | `20`                    | Max signup/login requests per window, per IP (and per email for login)                       |
| `AUTH_RATE_LIMIT_WINDOW_MIN` | no          | `15`                    | Rate limit window in minutes                                                                 |
| `TRUST_PROXY`                | no          | `0`                     | Set `1` behind a reverse proxy so client IPs are read correctly                              |
| `SANDBOX_DRIVER`             | no          | `docker`                | `docker` executes in the sandbox; `fake` is deterministic and never runs code                |
| `JUDGE_IMAGE`                | no          | `oj-judge-runtime:dev`  | Local Docker image used by the worker                                                        |
| `JUDGE_CONCURRENCY`          | no          | `1`                     | Number of submissions processed concurrently                                                 |
| `JUDGE_MAX_ATTEMPTS`         | no          | `3`                     | Max worker attempts before an internal `ERROR`                                               |
| `JUDGE_LEASE_SEC`            | no          | `60`                    | Job lease duration; workers heartbeat while judging                                          |
| `JUDGE_JOB_RETENTION_DAYS`   | no          | `30`                    | TTL retention for completed judge jobs                                                       |
| `JUDGE_CPUSET`               | no          | unset                   | Optional Docker CPU pinning list, such as `0` or `0-2`                                       |
| `LLM_PROVIDER`               | no          | `mock`                  | `mock`, `openai`, or `groq`                                                                   |
| `LLM_MODEL`                  | conditional | `gpt-4o-mini`           | Model ID sent to the provider; required for `groq`                                            |
| `LLM_BASE_URL`               | no          | Provider-specific       | OpenAI-compatible API URL; defaults to Groq's API URL when `LLM_PROVIDER=groq`               |
| `LLM_API_KEY`                | conditional | empty                   | Required for `openai` and `groq`; keep it in your deployment's secret store                  |
| `LLM_TIMEOUT_MS`             | no          | `15000`                 | Provider and classifier request timeout in milliseconds                                      |
| `AI_MAX_TOKENS`              | no          | `400`                   | Maximum completion token budget (32-8192)                                                    |
| `AI_DAILY_MESSAGE_LIMIT`     | no          | `30`                    | Per-user, per-problem daily chat limit                                                       |
| `AI_MIN_ATTEMPT_CHARS`       | no          | `20`                    | Minimum non-whitespace code characters for a counted failed attempt                          |
| `AI_L2_UNLOCK_MINUTES`       | no          | `15`                    | Time on a problem before L2 becomes available                                                |
| `AI_UNLOCK_COOLDOWN_SEC`     | no          | `300`                   | Cooldown between explicit L3/L4 unlocks                                                      |
| `AI_LEAK_CLASSIFIER`         | no          | `on`                    | Use a second provider call to classify possible leaks (fails closed)                         |
| `AI_REDTEAM_LIVE`            | no          | `0`                     | Must be `1` to explicitly run the hosted-model red-team evaluation                           |

The API refuses to start if a required variable is missing or invalid, and lists what is wrong. If your system DNS resolver cannot resolve your Atlas `mongodb+srv://` hostname, set `DNS_SERVERS=1.1.1.1,8.8.8.8` in `.env`; this changes DNS only for the Node process.

To use Groq, configure the API service with:

```dotenv
LLM_PROVIDER=groq
LLM_MODEL=qwen/qwen3.8-27b
LLM_API_KEY=<Groq API key>
```

Groq's OpenAI-compatible API URL is selected automatically. Confirm the exact model ID is available to your Groq account; model IDs and availability can change. In AWS, store `LLM_API_KEY` in AWS Secrets Manager or another secret manager and inject it into the API service at runtime. Do not commit the key or bake it into a container image.

`LLM_MAX_TOKENS` is accepted as a legacy alias; if both token settings are present, `AI_MAX_TOKENS` takes precedence. Provider failures produce fallback guidance in the tutor and an `ai.provider_failed` server log entry with the provider/model and upstream error (never the API key).

## Running

Start the API and frontend without Docker:

```bash
npm run dev
```

Open `http://localhost:5173`. Browse published problems at `/problems`, then sign in. The tutor works with `LLM_PROVIDER=mock`; for real model-generated replies, set `LLM_PROVIDER=openai` or `LLM_PROVIDER=groq`, and configure the required provider credentials.

To run and judge submitted code, build the isolated runtime image and start the separate worker:

```bash
npm run build:judge-image
npm run dev:worker
```

Run (sample tests only) and Submit (all tests) enqueue work through authenticated `/api/submissions` endpoints. The API process never executes submitted code. `SANDBOX_DRIVER=fake` can exercise queue/UI flows without Docker, but it does not compile or execute submissions.

Generate draft tutor notes for a seed problem with `npm run generate-ai-notes -- <slug>`. The script requires a real provider (`openai` or `groq`), saves notes as unreviewed, and records lint warnings. An admin can review clean notes using `POST /api/problems/:id/ai-context/review`; any lint override must be explicit and is logged.

The deterministic red-team and helpfulness suites run with `npm test`. For an opt-in hosted-model evaluation, set `AI_REDTEAM_LIVE=1` in `.env` and run `npm run ai:redteam`.

Run `npm run judge:calibrate` on each new worker host to collect a small CPU timing baseline. `npm run verify-seed` builds/runs every reference, wrong, and slow seed solution against Docker and can take several minutes. Docker Desktop timing on Windows/macOS differs from native Linux; use Linux for real timing validation.

Admins can open `/admin` to create or edit problems and their inline or file-backed test cases. File-backed cases keep their expected output in MongoDB for worker-side comparison; only the input is read from the seed directory. Promote an account with the command below, then sign in again so the updated role is reflected in the access token. Review problem statements and test cases before checking “Published publicly”. Public problem details include sample cases only.

To run only the API without reload, use `npm start`. The API can also be checked at `http://localhost:4000/healthz`.

## Deploying to an EC2 instance

The client uses same-origin `/api` requests. In production, build the client and serve `client/dist` through Nginx, proxy `/api/` and `/healthz` to the Express API on `127.0.0.1:4000`, and enable HTTPS. The Nginx site template is [`deploy/nginx/codexa.conf`](deploy/nginx/codexa.conf); it includes SSE settings so tutor responses are not buffered.

For an Ubuntu EC2 host:

1. Install a supported Node.js version, Nginx, and Git. Restrict the EC2 security group to SSH from your IP and HTTP/HTTPS publicly; do not expose port 4000.
2. Clone the repository to `/opt/codexa/oj`, install dependencies with `npm ci`, and build with `npm run build`.
3. Configure MongoDB Atlas to allow the EC2 egress IP and create a least-privilege database user. Create `/etc/codexa/api.env` with `NODE_ENV=production`, `HOST=127.0.0.1`, `PORT=4000`, `TRUST_PROXY=1`, `CORS_ORIGINS=https://your-domain.example`, `MONGODB_URI`, a newly generated `JWT_ACCESS_SECRET`, and the selected server-side LLM settings. Restrict this file to the API service account (for example, owner `root:codexa` and mode `640`); never put the LLM key in Vite/client variables or Git.
4. Create the `codexa` service account, copy [`deploy/systemd/codexa-api.service`](deploy/systemd/codexa-api.service) to `/etc/systemd/system/`, adjust `ExecStart` if Node is installed outside `/usr/bin/node`, then run `sudo systemctl daemon-reload && sudo systemctl enable --now codexa-api`. Keep the API bound to localhost or block its port at the security group/firewall.
5. Copy the Nginx template to `/etc/nginx/sites-available/codexa`, update its `server_name` and frontend `root` to `/opt/codexa/oj/client/dist`, enable it, then run `sudo nginx -t` and reload Nginx. Use Certbot (or another ACME client) to provision HTTPS before accepting production logins; production refresh cookies require HTTPS.
6. Check `https://your-domain.example/healthz`, sign in, and send a tutor message. If the tutor reports fallback guidance, check the API logs for `ai.provider_failed`; 401/403 usually indicates a key/permissions issue, 404/400 often means the model ID/configuration is wrong, and 429 indicates a quota/rate limit.

Rotate any credentials that were exposed before deploying. Replace the MongoDB password, Groq/OpenAI key, and JWT secret via their issuing systems; changing the JWT secret invalidates existing access tokens. Inject replacement values into the server environment at runtime rather than sharing them in chat or source control. The repository changes cannot revoke provider keys or update your running EC2 instance without your AWS/provider access.

Seed or refresh the five original, unpublished sample problems in MongoDB:

```bash
npm run seed
```

This upserts the problem records and replaces their ordered test cases. Compact stress-case recipes in the seed JSON are expanded into ordinary input strings when imported. It requires the existing `.env` MongoDB configuration. Seed problems are unpublished until reviewed; their AI teaching notes are also marked unreviewed. Review the content and test coverage before publishing them from the admin editor.

Import a problem JSON file (with a `problem` object and optional `testCases` array) as an unpublished scraped problem:

```bash
npm run import-problem -- path/to/problem.json
```

The importer validates data through the problem service, forces `source.type` to `scraped` and `isPublished` to `false`, and never scrapes websites itself.

## Problems API

| Method       | Path                                          | Access                                          |
| ------------ | --------------------------------------------- | ----------------------------------------------- |
| GET          | `/api/problems?tag=&difficulty=&page=&limit=` | Public, published only                          |
| GET          | `/api/problems/:slug`                         | Public, published problem and sample tests only |
| GET          | `/api/problems/admin/list`                    | Admin, includes drafts                          |
| POST         | `/api/problems`                               | Admin                                           |
| PUT / DELETE | `/api/problems/:id`                           | Admin; DELETE unpublishes                       |
| GET / POST   | `/api/problems/:id/testcases`                 | Admin                                           |
| PUT / DELETE | `/api/problems/:id/testcases/:testCaseId`     | Admin                                           |

Public list/detail routes never return hidden test inputs or expected outputs. For the full request/response definitions, see `docs/openapi.yaml`.

Submission routes require a bearer access token:

| Method | Path                    | Purpose                                                                |
| ------ | ----------------------- | ---------------------------------------------------------------------- |
| POST   | `/api/submissions`      | Queue `{ problemId, language, code, mode }`; mode is `run` or `submit` |
| GET    | `/api/submissions/:id`  | Poll your submission status and safe result metadata                   |
| GET    | `/api/submissions/mine` | List your own paginated submission history                             |

Run responses include sample output only. Submit responses include verdict, runtime, memory, and the first failed test index/category, never hidden input or expected output. The API returns `202` with a submission ID; poll the returned `statusUrl` until status is `DONE` or `ERROR`.

Make a user an admin (revokes their existing sessions so the new role takes effect):

```bash
npm run user:promote -- someone@example.com          # grant admin
npm run user:promote -- someone@example.com user     # revoke admin
```

## Auth API

| Method | Path                | Notes                                                                        |
| ------ | ------------------- | ---------------------------------------------------------------------------- |
| POST   | `/api/auth/signup`  | `{ username, email, password }` -> 201, access token in body, refresh cookie |
| POST   | `/api/auth/login`   | `{ email, password }` -> 200, same shape                                     |
| POST   | `/api/auth/refresh` | uses the `oj_rt` cookie; rotates it                                          |
| POST   | `/api/auth/logout`  | revokes the session, clears the cookie                                       |
| GET    | `/api/auth/me`      | `Authorization: Bearer <accessToken>`                                        |

Full contract: [`docs/openapi.yaml`](docs/openapi.yaml).

Quick check with curl:

```bash
curl -i -c jar.txt -H 'Content-Type: application/json' \
  -d '{"username":"alice","email":"alice@example.com","password":"correct-horse"}' \
  localhost:4000/api/auth/signup
curl -i -b jar.txt -c jar.txt -X POST localhost:4000/api/auth/refresh
```

Security notes:

- Passwords use argon2id. Login errors are generic, and unknown emails take the same time as wrong passwords.
- Access JWTs are short-lived (15 min). Refresh tokens are random 256-bit values. Only their SHA-256 hash is stored. They rotate on every refresh, and reusing a rotated token revokes the whole session family.
- The refresh cookie is `HttpOnly`, `SameSite=Strict`, scoped to `/api/auth`, and `Secure` in production.

## Tests

```bash
npm test     # API, model, seed, and frontend tests
npm run lint
npm run build
npm run verify-seed
```

The regular tests use `FakeSandboxRunner` and need no Docker. Docker torture tests are automatically skipped with a clear message if the judge image is unavailable. The first test run downloads a MongoDB binary (about 100 MB) into `~/.cache/mongodb-binaries`.

## Project structure

```
oj/
  CLAUDE.md, README.md, .env.example
  client/              Vite + React app, auth, Monaco workspace, problem/admin pages
  docs/                HLD.md, openapi.yaml
  judge-runtime/       Docker image and unprivileged-code supervisor
  scripts/             combined API/client development launcher
  server/
    src/
      server.js        API entry
      worker.js        separate Mongo-backed judge worker
      app.js           createApp() for server and tests
      config/          env.js (zod-validated), constants.js
      modules/         auth, problems, submissions, judge, ai models
      middleware/      auth (requireAuth, requireRole), rateLimit, validate, errorHandler, requestLogger
      utils/           AppError, logger, db
    seed/
      problems/        five problem/testcase JSON fixtures
      reference/       Python/C++ references and Python wrong/slow variants
    scripts/           promote-admin.js, seed.js, import-problem.js, verify-seed.js, judge-calibrate.js
    tests/             API/unit tests and Docker-conditional judge torture tests
```

## Troubleshooting

- **"Invalid environment configuration"**: the message lists each bad variable. Compare with `.env.example`.
- **`MongooseServerSelectionError`**: MongoDB is not reachable at `MONGODB_URI`. Check that it is running, and for Atlas check the IP allow-list.
- **`querySrv ECONNREFUSED`**: Node's configured DNS resolver refused the Atlas SRV lookup. This is separate from the Atlas IP allow-list. Try setting `DNS_SERVERS=1.1.1.1,8.8.8.8` in `.env`, then restart the API.
- **`EADDRINUSE`**: port 4000 is taken. Set `PORT` in `.env`.
- **Docker image missing**: run `npm run build:judge-image`, then restart the worker.
- **Docker Desktop timing differs**: expected on Windows/macOS; validate performance limits on native Linux.
- **Submission stays `QUEUED`**: start `npm run dev:worker` and verify its MongoDB/Docker startup logs.
- **Docker permissions or daemon errors**: the worker needs access to the Docker daemon; never give the API or sandbox container access to the Docker socket.
- **Test download fails**: `mongodb-memory-server` needs internet on the first run. Behind a proxy, set `MONGOMS_DOWNLOAD_URL` or `MONGOMS_SYSTEM_BINARY` (see the package docs).

## Not included / next steps

- M7 to M8 per `CLAUDE.md` (AI tutor and final hardening).
- Owner tasks: Dockerizing the app, Docker Hub, and AWS deployment.
