# Manual Konfiguracji

Ten plik pokazuje, które wartości w `.env` musisz uzupełnić recznie, które są opcjonalne i które zwykle można zostawić bez zmian.

## 1. Start

Jeśli jeszcze nie masz własnego `.env`:

```bash
cp .env.example .env
```

Potem edytuj `.env` i uzupelnij pola opisane niżej.

## 2. Pola, które musisz uzupelnic recznie

### Wymagane zawsze

#### `DB_PASSWORD`

Hasło do Postgresa używane przez `docker-compose.yml`.

Przykład:

```env
DB_PASSWORD=super_mocne_haslo
```

#### `DATABASE_URL`

Adres bazy danych.

Lokalnie:

```env
DATABASE_URL=postgresql://biuro:super_mocne_haslo@127.0.0.1:5432/autonomiczne_biuro
```

Ważne:

- hasło w `DATABASE_URL` powinno zgadzać się z `DB_PASSWORD`
- przy Dockerze kontener `server` i `worker` i tak dostają własny `DATABASE_URL` z `docker-compose.yml`, ale lokalne narzędzia i migracje nadal korzystają z `.env`

### Wymagane praktycznie

Musisz podać przynajmniej jeden klucz do providera LLM, jeśli chcesz, żeby agenci naprawdę pracowali.

#### `ANTHROPIC_API_KEY`

```env
ANTHROPIC_API_KEY=twoj_klucz_anthropic
```

#### `OPENAI_API_KEY`

```env
OPENAI_API_KEY=twoj_klucz_openai
```

#### `GOOGLE_API_KEY`

```env
GOOGLE_API_KEY=twoj_klucz_google
```

W praktyce:

- wystarczy jeden provider, ale dobrze mieć fallback
- jeśli używasz embeddings OpenAI, przyda się też `OPENAI_API_KEY`

### Mocno zalecane

#### `GRAFANA_ADMIN_PASSWORD`

Hasło do lokalnej Grafany, jeśli uruchamiasz observability przez Docker.

```env
GRAFANA_ADMIN_PASSWORD=zmien_to_haslo
```

Ważne:

- `docker-compose.yml` nie ma już domyślnego fallbacku dla tego pola
- nie zostawiaj wartości typu `admin`

## 3. Pola do uzupelnienia tylko jeśli używasz danej funkcji

### Slack i Discord inbound integrations

#### `SLACK_SIGNING_SECRET`

Ustaw tylko, jeśli chcesz odbierać eventy lub interakcje ze Slacka.

```env
SLACK_SIGNING_SECRET=twoj_slack_signing_secret
```

#### `DISCORD_WEBHOOK_SECRET`

Ustaw tylko, jeśli chcesz przyjmować webhooki z Discorda.

```env
DISCORD_WEBHOOK_SECRET=twoj_wlasny_tajny_sekret
```

### Template marketplace

#### `TEMPLATE_MARKETPLACE_URL`

Jeśli używasz własnego katalogu templatek, wpisz swój URL. W przeciwnym razie możesz zostawić domyślny.

### Observability eksport zewnętrzny

#### `OTEL_EXPORTER_OTLP_ENDPOINT`

Ustaw tylko, jeśli wysyłasz trace poza lokalny stack Dockera.

Przykład:

```env
OTEL_EXPORTER_OTLP_ENDPOINT=http://twoj-collector:4318/v1/traces
```

### Pricing override

#### `LLM_PRICING_OVERRIDES`

Opcjonalne. Ustaw tylko, jeśli chcesz nadpisać cennik tokenów per model.

Przykład:

```env
LLM_PRICING_OVERRIDES={"claude-sonnet-4-20250514":{"input_per_million_usd":3,"output_per_million_usd":15}}
```

## 4. Pola, które zwykle możesz zostawić bez zmian

Najczęściej nie trzeba ruszać:

```env
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
CLAUDE_MODEL=claude-sonnet-4-20250514
OPENAI_MODEL=gpt-4o
GEMINI_MODEL=gemini-2.0-flash
TEMPLATE_MARKETPLACE_CACHE_TTL_MS=300000
ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173
REDIS_PASSWORD=change_me_redis_password
REDIS_URL=redis://:change_me_redis_password@localhost:6379
WORKSPACE_ROOT=./workspace
BASH_SANDBOX_MODE=docker
BASH_SANDBOX_DOCKER_BINARY=docker
BASH_SANDBOX_IMAGE=alpine/git:2.47.2
BASH_SANDBOX_WORKDIR=/workspace
BASH_SANDBOX_TIMEOUT_MS=10000
BASH_SANDBOX_MEMORY_MB=256
BASH_SANDBOX_CPU_LIMIT=1
BASH_SANDBOX_PIDS_LIMIT=64
BASH_SANDBOX_USER=65534:65534
EVENT_BUS_CHANNEL=biuro:events
SCHEDULER_STREAM_KEY=biuro:scheduler:wakeups
SCHEDULER_STREAM_BLOCK_MS=1000
LLM_ROUTER_ENABLED=true
LLM_ROUTER_FALLBACK_ORDER=gemini,claude,openai
LLM_MOCK_MODE=false
AUTH_RATE_LIMIT_WINDOW_MS=900000
AUTH_RATE_LIMIT_MAX=20
WS_RATE_LIMIT_WINDOW_MS=60000
WS_RATE_LIMIT_MAX=30
OTEL_SERVICE_NAME=autonomiczne-biuro
OTEL_TRACE_CONSOLE_EXPORTER=false
OTEL_TRACE_HISTORY_LIMIT=200
WORKER_METRICS_PORT=9464
OTEL_COLLECTOR_HOST_PORT=4318
WORKER_METRICS_HOST_PORT=9464
TEMPO_HOST_PORT=3202
PORT=3100
HEARTBEAT_INTERVAL_MS=30000
MAX_CONCURRENT_HEARTBEATS=20
DAILY_DIGEST_ENABLED=true
DAILY_DIGEST_HOUR_UTC=18
DAILY_DIGEST_MINUTE_UTC=0
DAILY_DIGEST_SWEEP_INTERVAL_MS=60000
LOG_LEVEL=info
AUTH_ENABLED=true
```

`DAILY_DIGEST_*`:

- opcjonalne
- steruja automatycznym dziennym raportem wysylanym przez webhooki Slack/Discord
- domyslnie raport jest sprawdzany co `60000 ms` i wysylany po `18:00 UTC`

## 5. Minimalne konfiguracje

### Najmniejsze sensowne `.env` lokalnie

```env
DB_PASSWORD=super_mocne_haslo
DATABASE_URL=postgresql://biuro:super_mocne_haslo@127.0.0.1:5432/autonomiczne_biuro
OPENAI_API_KEY=twoj_klucz_openai
AUTH_ENABLED=true
WORKSPACE_ROOT=./workspace
```

### Minimalne sensowne `.env` do Dockera

```env
DB_PASSWORD=super_mocne_haslo
ANTHROPIC_API_KEY=twoj_klucz_anthropic
OPENAI_API_KEY=twoj_klucz_openai
GOOGLE_API_KEY=twoj_klucz_google
AUTH_ENABLED=true
GRAFANA_ADMIN_PASSWORD=zmien_to_haslo
```

## 6. Szybka checklista

Przed startem upewnij się, że masz uzupelnione:

- `DB_PASSWORD`
- `DATABASE_URL`
- przynajmniej jeden z: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`
- `AUTH_ENABLED=true`
- opcjonalnie: `SLACK_SIGNING_SECRET`, `DISCORD_WEBHOOK_SECRET`, `GRAFANA_ADMIN_PASSWORD`

## 7. Weryfikacja po uzupelnieniu

### Sprawdzenie, czy backend akceptuje env

```bash
pnpm --filter @biuro/server exec tsx -e "import './src/env.ts'; console.log('env ok')"
```

### Start lokalny

```bash
pnpm dev
```

### Start przez Docker

```bash
docker compose up -d
```

## 8. Ważna uwaga bezpieczeństwa

Nie commituj prawdziwych kluczy API do repo.

Jeśli w istniejącym `.env` masz już prawdziwe sekrety:

- traktuj ten plik jako lokalny
- nie wrzucaj go do gita
- jeśli klucze były gdziekolwiek udostępnione, zrotuj je u providera
