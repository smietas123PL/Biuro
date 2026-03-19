<div align="center">

# 🏢 Autonomiczne Biuro

**Open-source orchestration for autonomous AI companies.**

If your AI agent is an employee, Autonomiczne Biuro is the company.

A Node.js server and React dashboard that orchestrates a team of AI agents to run a business. Bring your own agents, assign goals, and track your agents' work and costs from one dashboard.

It looks like a task manager — but under the hood it has org charts, budgets, governance, goal alignment, and agent coordination.

[Quickstart](#-quickstart) · [Features](#-features) · [Architecture](#-architecture) · [CLI](#-cli) · [Templates](#-templates) · [API Reference](#-api-reference) · [FAQ](#-faq)

---

**Manage business goals, not pull requests.**

| Step | Example |
|------|---------|
| 01 — Define the goal | *"Build the #1 AI note-taking app to $1M MRR."* |
| 02 — Hire the team | CEO, CTO, engineers, designers, marketers — any bot, any provider. |
| 03 — Approve and run | Review strategy. Set budgets. Hit go. Monitor from the dashboard. |

</div>

---

## 🚀 Quickstart

### Prerequisites

- **Node.js** 20+
- **pnpm** 9.15+
- **PostgreSQL** 16+ (or use Docker)

### Option 1: Local Development

```bash
# Clone
git clone https://github.com/your-org/autonomiczne-biuro.git
cd autonomiczne-biuro

# Install dependencies
pnpm install

# Set up environment
cp .env.example .env
# Edit .env with your API keys

# Create database
createdb autonomiczne_biuro

# Run migrations
pnpm --filter @biuro/server migrate

# Inspect migration state
pnpm --filter @biuro/server migrate:status

# Verify recorded checksums vs files
pnpm --filter @biuro/server migrate:verify

# Create a new numbered migration file
pnpm --filter @biuro/server migrate:create "add budget indexes"

# Start development
pnpm dev
```

This starts:
- **API Server** at `http://localhost:3100`
- **Dashboard** at `http://localhost:3200`

### Option 2: Docker

```bash
# Clone and configure
git clone https://github.com/your-org/autonomiczne-biuro.git
cd autonomiczne-biuro
cp .env.example .env
# Edit .env with your API keys

# Launch everything
docker compose up -d

# Dashboard: http://localhost:3200
# API:       http://localhost:3100
```

### Option 3: One-Click Template

```bash
# Start server, then import a preset company
pnpm dev

# In another terminal:
pnpm --filter @biuro/cli dev -- template import-preset saas-startup.json
```

This creates a full company with 5 agents (CEO, CTO, Developer, Designer, Marketer), goals, tools, and governance policies — ready to work in seconds.

---

## 📋 Features

### 🔌 Bring Your Own Agent
Any agent, any runtime, one org chart. If it can receive a heartbeat, it's hired.

```
Works with: Claude · GPT-4o · OpenAI Codex · Cursor · Custom HTTP · Bash scripts
```

### 🎯 Goal Alignment
Every task traces back to the company mission. Agents know *what* to do and *why*.

```
Mission: "Build #1 AI note-taking app"
  → Goal: "Launch MVP"
    → Goal: "Core product features"
      → Task: "Implement rich text editor"
        → Agent: Charlie (developer)
```

### 💓 Heartbeats
Agents wake on a schedule, check for work, and act. Delegation flows up and down the org chart.

```
Every 30 seconds:
  1. Check budget → still within limits?
  2. Check safety → no loops detected?
  3. Find work → assigned task waiting?
  4. Build context → mission + goal + task + history
  5. Execute → call LLM runtime
  6. Process actions → complete, delegate, message, use tool
  7. Log everything → audit trail
```

### 💰 Cost Control
Monthly budgets per agent. When they hit the limit, they stop. No runaway costs.

```
Alice (CEO):      $2.34 / $15.00  [████████░░░░░░░░] 15.6%
Bob (CTO):        $8.12 / $20.00  [████████████░░░░] 40.6%
Charlie (Dev):    $24.50 / $30.00  [█████████████░░░] 81.7% ⚠️
```

### 🏢 Multi-Company
One deployment, many companies. Complete data isolation. One control plane for your portfolio.

### 🎫 Ticket System
Every conversation is traced. Every decision is explained. Full tool-call tracing and immutable audit log.

### 🛡️ Governance
You're the board. Approve hires, override strategy, pause or terminate any agent — at any time.

```
Policies:
  ✅ "Strategy changes need board approval"
  ✅ "Budget warning at 75%"
  ✅ "Max 4 levels of delegation"
  ✅ "Heartbeat rate limit: 30/hour"
```

### 📊 Org Chart
Hierarchies, roles, reporting lines. Your agents have a boss, a title, and a job description.

```
Board (You)
  └── Alice (CEO)
      ├── Bob (CTO)
      │   ├── Charlie (Developer)
      │   └── Diana (Designer)
      └── Eve (Head of Marketing)
```

### 🔧 Tools
Register any tool — HTTP APIs, bash commands, built-in functions — and assign them to agents with permissions and rate limits.

```
web_search    → CTO, Marketer      (50/hour)
file_write    → Developer, Designer (100/hour)
github_api    → Developer           (30/hour)
```

### 📦 Templates
Export and import entire companies. Browse preset templates and launch a new company in seconds.

### 🔗 Integrations
Connect Slack, Discord, email, or custom webhooks to get notified about events.

### 📊 Reports
Generate daily summaries, weekly reports, and cost reports — on-demand or scheduled.

### 📱 Mobile Ready
Monitor and manage your autonomous businesses from anywhere. Responsive design with mobile sidebar.

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Dashboard UI                      │
│                 React + Vite + Tailwind              │
│                                                      │
│  Dashboard · Agents · Tasks · Goals · Org Chart      │
│  Tools · Policies · Approvals · Budgets · Audit Log  │
│  Templates · Integrations · Reports                  │
└────────────────────────┬────────────────────────────┘
                    REST │ WebSocket
┌────────────────────────▼────────────────────────────┐
│                    API Server                        │
│                 Node.js + Express                    │
│                                                      │
│  ┌────────────┐ ┌────────────┐ ┌──────────────────┐ │
│  │   Auth &   │ │  Routes    │ │  WebSocket Hub   │ │
│  │   RBAC     │ │  (REST)    │ │  (live events)   │ │
│  └────────────┘ └────────────┘ └──────────────────┘ │
│                                                      │
│  ┌────────────┐ ┌────────────┐ ┌──────────────────┐ │
│  │Orchestrator│ │   Tool     │ │   Governance     │ │
│  │ Heartbeats │ │  Executor  │ │   Policies       │ │
│  │ Scheduler  │ │  Registry  │ │   Approvals      │ │
│  │ Context    │ │  Builtins  │ │   Rollback       │ │
│  │ Checkout   │ │            │ │                  │ │
│  └─────┬──────┘ └────────────┘ └──────────────────┘ │
│        │                                             │
│  ┌─────▼──────┐ ┌────────────┐ ┌──────────────────┐ │
│  │  Safety    │ │ Templates  │ │  Integrations    │ │
│  │  Loops     │ │ Export     │ │  Slack/Discord   │ │
│  │  Budgets   │ │ Import     │ │  Email/Webhook   │ │
│  │  Auto-pause│ │ Presets    │ │  Reports         │ │
│  └────────────┘ └────────────┘ └──────────────────┘ │
└────────────────────────┬────────────────────────────┘
              ┌──────────┼──────────┐
              ▼          ▼          ▼
       ┌───────────┐ ┌───────┐ ┌────────┐
       │PostgreSQL │ │Claude │ │ Tools  │
       │           │ │OpenAI │ │        │
       │companies  │ │HTTP   │ │search  │
       │agents     │ │Bash   │ │files   │
       │tasks      │ │       │ │github  │
       │goals      │ │       │ │custom  │
       │messages   │ │       │ │        │
       │budgets    │ └───────┘ └────────┘
       │tools      │
       │policies   │
       │approvals  │
       │audit_log  │
       │heartbeats │
       │sessions   │
       │templates  │
       │...        │
       └───────────┘
```

### How a Heartbeat Works

```
┌─────────────────────────────────────────────────────┐
│                 HEARTBEAT CYCLE                      │
│                                                      │
│  1. Budget check ────── Over limit? → SKIP           │
│  2. Safety check ────── Loop detected? → AUTO-PAUSE  │
│  3. Policy check ────── Approval needed? → GATE      │
│  4. Find work ───────── No tasks? → IDLE             │
│  5. Atomic checkout ─── Lock task (FOR UPDATE SKIP)  │
│  6. Build context:                                   │
│     ┌──────────────────────────────┐                 │
│     │ Company Mission              │                 │
│     │ → Goal Chain (why)           │                 │
│     │ → Task Description (what)    │                 │
│     │ → Conversation History       │                 │
│     │ → Available Tools            │                 │
│     │ → Org Context (boss/reports) │                 │
│     │ → Previous Session State     │                 │
│     └──────────────────────────────┘                 │
│  7. Execute agent (Claude/OpenAI/HTTP/Bash)          │
│  8. Process actions:                                 │
│     • complete_task → mark done, notify              │
│     • delegate → create subtask for subordinate      │
│     • use_tool → permission check → execute → log    │
│     • message → send to another agent                │
│     • request_approval → create gate                 │
│     • blocked → mark task, explain why               │
│     • continue → save state, resume next beat        │
│  9. Record cost → update budget                      │
│ 10. Audit log → immutable record                     │
│ 11. Dispatch events → integrations                   │
│ 12. Broadcast → WebSocket → dashboard                │
└─────────────────────────────────────────────────────┘
```

---

## 📁 Project Structure

```
autonomiczne-biuro/
├── packages/
│   ├── server/                    # API + Orchestrator
│   │   ├── src/
│   │   │   ├── index.ts           # Express app + startup
│   │   │   ├── env.ts             # Environment config
│   │   │   ├── db/
│   │   │   │   ├── schema.sql     # Database schema
│   │   │   │   ├── schema-v2.sql  # Tools, governance tables
│   │   │   │   ├── schema-v4.sql  # Auth, templates, integrations
│   │   │   │   ├── client.ts      # PostgreSQL pool
│   │   │   │   └── migrate.ts     # Migration runner
│   │   │   ├── routes/
│   │   │   │   ├── companies.ts
│   │   │   │   ├── agents.ts
│   │   │   │   ├── tasks.ts
│   │   │   │   ├── goals.ts
│   │   │   │   ├── messages.ts
│   │   │   │   ├── tools.ts
│   │   │   │   ├── budgets.ts
│   │   │   │   ├── approvals.ts
│   │   │   │   ├── auth.ts
│   │   │   │   ├── templates.ts
│   │   │   │   ├── integrations.ts
│   │   │   │   ├── reports.ts
│   │   │   │   └── index.ts
│   │   │   ├── orchestrator/
│   │   │   │   ├── heartbeat.ts   # Main heartbeat loop
│   │   │   │   ├── context.ts     # Context builder
│   │   │   │   ├── checkout.ts    # Atomic task checkout
│   │   │   │   ├── scheduler.ts   # Cron-like scheduler
│   │   │   │   └── safety.ts      # Loop detection, limits
│   │   │   ├── runtimes/
│   │   │   │   ├── types.ts       # AgentAction, AgentResponse
│   │   │   │   ├── claude.ts      # Anthropic runtime
│   │   │   │   ├── openai.ts      # OpenAI runtime
│   │   │   │   └── registry.ts    # Runtime registry
│   │   │   ├── tools/
│   │   │   │   ├── registry.ts    # Tool permissions
│   │   │   │   ├── executor.ts    # Tool execution engine
│   │   │   │   └── builtin/       # Built-in tools
│   │   │   │       ├── web-search.ts
│   │   │   │       ├── file-ops.ts
│   │   │   │       ├── http-request.ts
│   │   │   │       └── index.ts
│   │   │   ├── governance/
│   │   │   │   ├── policies.ts    # Policy evaluation
│   │   │   │   ├── approvals.ts   # Approval workflow
│   │   │   │   └── rollback.ts    # Config versioning
│   │   │   ├── auth/
│   │   │   │   ├── tokens.ts      # Session + API key mgmt
│   │   │   │   ├── roles.ts       # Permission definitions
│   │   │   │   ├── rbac.ts        # Access control checks
│   │   │   │   └── middleware.ts   # Express middleware
│   │   │   ├── templates/
│   │   │   │   ├── exporter.ts    # Company → template
│   │   │   │   ├── importer.ts    # Template → company
│   │   │   │   ├── sanitizer.ts   # Secret scrubbing
│   │   │   │   └── presets/       # Pre-built templates
│   │   │   │       └── saas-startup.json
│   │   │   ├── integrations/
│   │   │   │   ├── registry.ts    # Event dispatcher
│   │   │   │   ├── slack.ts
│   │   │   │   ├── discord.ts
│   │   │   │   ├── email.ts
│   │   │   │   └── webhooks.ts
│   │   │   ├── reports/
│   │   │   │   ├── generator.ts   # Report data collection
│   │   │   │   ├── scheduler.ts   # Scheduled report runner
│   │   │   │   └── templates/
│   │   │   │       └── daily-summary.ts
│   │   │   ├── ws/
│   │   │   │   └── hub.ts         # WebSocket server
│   │   │   └── utils/
│   │   │       ├── logger.ts      # Pino logger
│   │   │       └── ids.ts         # UUID generator
│   │   ├── tests/
│   │   │   ├── setup.ts
│   │   │   ├── companies.test.ts
│   │   │   ├── tasks.test.ts
│   │   │   └── safety.test.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── dashboard/                 # React UI
│   │   ├── src/
│   │   │   ├── main.tsx
│   │   │   ├── App.tsx
│   │   │   ├── api/client.ts      # API client
│   │   │   ├── hooks/
│   │   │   │   ├── useApi.ts
│   │   │   │   └── useWebSocket.ts
│   │   │   ├── components/
│   │   │   │   ├── Layout.tsx      # Responsive layout
│   │   │   │   ├── Sidebar.tsx     # Navigation
│   │   │   │   ├── Modal.tsx
│   │   │   │   ├── Form.tsx        # Input, Textarea, Select, Button
│   │   │   │   ├── StatusBadge.tsx
│   │   │   │   ├── CostBadge.tsx
│   │   │   │   ├── AgentAvatar.tsx
│   │   │   │   ├── LiveFeed.tsx    # Real-time event stream
│   │   │   │   ├── MessageThread.tsx
│   │   │   │   ├── GoalTree.tsx
│   │   │   │   ├── EmptyState.tsx
│   │   │   │   ├── ConfirmDialog.tsx
│   │   │   │   ├── CreateAgentForm.tsx
│   │   │   │   ├── CreateTaskForm.tsx
│   │   │   │   ├── CreateGoalForm.tsx
│   │   │   │   ├── CreateToolForm.tsx
│   │   │   │   ├── CreatePolicyForm.tsx
│   │   │   │   └── CreateCompanyForm.tsx
│   │   │   ├── pages/
│   │   │   │   ├── DashboardPage.tsx
│   │   │   │   ├── AgentsPage.tsx
│   │   │   │   ├── AgentDetailPage.tsx
│   │   │   │   ├── TasksPage.tsx
│   │   │   │   ├── TaskDetailPage.tsx
│   │   │   │   ├── GoalsPage.tsx
│   │   │   │   ├── OrgChartPage.tsx
│   │   │   │   ├── ToolsPage.tsx
│   │   │   │   ├── PoliciesPage.tsx
│   │   │   │   ├── ApprovalsPage.tsx
│   │   │   │   ├── BudgetsPage.tsx
│   │   │   │   ├── AuditLogPage.tsx
│   │   │   │   ├── TemplatePage.tsx
│   │   │   │   ├── IntegrationsPage.tsx
│   │   │   │   └── ReportsPage.tsx
│   │   │   └── styles/globals.css
│   │   ├── package.json
│   │   └── vite.config.ts
│   │
│   └── cli/                       # Command-line tool
│       ├── src/
│       │   ├── index.ts
│       │   ├── commands/
│       │   │   ├── company.ts
│       │   │   ├── agent.ts
│       │   │   ├── task.ts
│       │   │   ├── template.ts
│       │   │   ├── status.ts
│       │   │   └── logs.ts
│       │   └── utils/
│       │       ├── api.ts
│       │       └── ui.ts
│       └── package.json
│
├── docker-compose.yml
├── Dockerfile.server
├── Dockerfile.dashboard
├── .env.example
├── pnpm-workspace.yaml
└── README.md
```

---

## ⚙️ Configuration

### Environment Variables

```env
# Required
DATABASE_URL=postgresql://localhost:5432/autonomiczne_biuro

# At least one required
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...

# Optional
PORT=3100                          # API server port
HEARTBEAT_INTERVAL_MS=30000        # How often agents check for work (30s)
LOG_LEVEL=info                     # debug | info | warn | error
AUTH_ENABLED=true                  # Keep enabled outside throwaway local dev
LLM_PRICING_OVERRIDES=             # Optional JSON map of per-model token pricing
WORKSPACE_ROOT=/tmp/biuro-workspace  # Root dir for file tools
```

### `.env.example`

```env
DATABASE_URL=postgresql://localhost:5432/autonomiczne_biuro
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
PORT=3100
HEARTBEAT_INTERVAL_MS=30000
LOG_LEVEL=info
AUTH_ENABLED=true
LLM_PRICING_OVERRIDES=
WORKSPACE_ROOT=/tmp/biuro-workspace
```

---

## ⌨️ CLI

### Installation

```bash
# From the repo
pnpm --filter @biuro/cli build
alias biuro="node packages/cli/dist/index.js"

# Or during development
alias biuro="pnpm --filter @biuro/cli dev --"
```

### Configuration

```bash
export BIURO_API_URL=http://localhost:3100    # API server URL
export BIURO_TOKEN=biuro_your_api_key        # Optional: API key
```

### Commands

```bash
# ─── Company Management ───

biuro company list
biuro company create --name "AI Startup" --mission "Build the future"
biuro company stats <companyId>

# ─── Agent Management ───

biuro agent list <companyId>
biuro agent hire <companyId> \
  --name "Alice" \
  --role "ceo" \
  --title "Chief Executive Officer" \
  --runtime claude \
  --budget 15 \
  --prompt "You are Alice, the CEO..."
biuro agent pause <agentId>
biuro agent resume <agentId>
biuro agent terminate <agentId>

# ─── Task Management ───

biuro task list <companyId>
biuro task list <companyId> --status in_progress
biuro task create <companyId> \
  --title "Build landing page" \
  --description "Create a modern, responsive landing page..." \
  --assign <agentId> \
  --priority 10
biuro task show <taskId>

# ─── Templates ───

biuro template list-presets
biuro template import-preset saas-startup.json
biuro template import-preset saas-startup.json --name "My Startup"
biuro template export <companyId> --output my-company.json
biuro template import my-company.json

# ─── Monitoring ───

biuro status                        # Overview of all companies
biuro logs <companyId>              # Recent audit log
biuro logs <companyId> --follow     # Stream live (polls every 5s)
biuro logs <companyId> --limit 50   # Last 50 entries
```

### Example Session

```bash
# 1. Import a preset company
$ biuro template import-preset saas-startup.json --name "NoteAI Inc."
✔ Company imported: NoteAI Inc.
  ID:       a1b2c3d4-...
  Agents:   5
  Goals:    5
  Tools:    2
  Policies: 3

# 2. Check status
$ biuro status
🏢 Autonomiczne Biuro Status

NoteAI Inc. (a1b2c3d4)
  Build and launch an AI-powered SaaS product to $1M ARR
  💰 Cost: $0.0000
  💓 Heartbeats (1h): 0
  👥 Agents: 0 working | 5 idle | 0 paused

# 3. Create a task for the CEO
$ biuro task create a1b2c3d4 \
  --title "Create Q1 product roadmap" \
  --description "Define features, milestones, and timeline for MVP launch" \
  --assign <ceo-agent-id> \
  --priority 10
✔ Task created: Create Q1 product roadmap
  ID: e5f6g7h8-...
  Status: assigned

# 4. Watch the agents work
$ biuro logs a1b2c3d4 --follow
09:00:01 💓 heartbeat.completed Alice $0.0034
09:00:02 📋 task.created Bob
09:00:31 💓 heartbeat.completed Bob $0.0028
09:00:32 📋 task.created Charlie
09:01:01 💓 heartbeat.completed Charlie $0.0041
09:01:02 ✅ task.completed Charlie
--- Following (Ctrl+C to stop) ---
```

---

## 📦 Templates

Templates let you export and import entire companies — agents, goals, tools, policies, and org structure.

### Preset Templates

| Template | Agents | Description |
|----------|--------|-------------|
| `saas-startup.json` | 5 (CEO, CTO, Developer, Designer, Marketer) | Full SaaS startup team with goals, tools, and governance |
| `content-agency.json` | — | Content creation agency *(coming soon)* |
| `dev-shop.json` | — | Development agency *(coming soon)* |

### Creating Custom Templates

```bash
# 1. Build your company through the dashboard or API
# 2. Export it
biuro template export <companyId> --output my-template.json

# 3. Share the template file
# (secrets are automatically scrubbed)

# 4. Others can import it
biuro template import my-template.json --name "My New Instance"
```

### Template Format

```json
{
  "version": "1.0.0",
  "name": "AI SaaS Startup",
  "description": "...",
  "company": { "name": "...", "mission": "..." },
  "goals": [
    { "ref": "goal_0", "parent_ref": null, "title": "..." }
  ],
  "agents": [
    {
      "ref": "agent_0",
      "name": "Alice",
      "role": "ceo",
      "reports_to_ref": null,
      "runtime": "claude",
      "system_prompt": "...",
      "monthly_budget_usd": 15
    }
  ],
  "tools": [...],
  "agent_tools": [...],
  "policies": [...]
}
```

**Security**: Templates automatically scrub sensitive values (`api_key`, `token`, `secret`, `password`, `webhook_url`) during export.

---

## 📡 API Reference

### Base URL

```
http://localhost:3100/api
```

### Authentication

When `AUTH_ENABLED=true`:

```bash
# Register
curl -X POST /api/auth/register \
  -d '{"email": "you@example.com", "name": "You", "password": "..."}'

# Login
curl -X POST /api/auth/login \
  -d '{"email": "you@example.com", "password": "..."}'
# Returns: { "token": "...", "user": {...} }

# Use token
curl -H "Authorization: Bearer <token>" /api/companies

# Or use API key
curl -H "Authorization: Bearer biuro_<key>" /api/companies
```

When `AUTH_ENABLED=false`: No auth required.

This should be treated as local-development-only. With auth disabled, the API and dashboard trust every request.

### Endpoints

#### Companies

```
POST   /api/companies                          Create company
GET    /api/companies                          List companies
GET    /api/companies/:id                      Get company
GET    /api/companies/:id/stats                Get company statistics
POST   /api/companies/:id/export               Export as template
```

#### Agents

```
POST   /api/companies/:id/agents               Hire agent
GET    /api/companies/:id/agents               List agents
GET    /api/companies/:id/org-chart            Get org chart tree
GET    /api/agents/:id                          Get agent detail
PATCH  /api/agents/:id                          Update agent
POST   /api/agents/:id/pause                    Pause agent
POST   /api/agents/:id/resume                   Resume agent
POST   /api/agents/:id/terminate                Terminate agent
GET    /api/agents/:id/heartbeats               Get heartbeat history
GET    /api/agents/:id/budgets                  Get budget history
POST   /api/agents/:id/budgets                  Set budget
```

#### Tasks

```
POST   /api/companies/:id/tasks                Create task
GET    /api/companies/:id/tasks                List tasks (?status=&assigned_to=)
GET    /api/tasks/:id                           Get task + messages + subtasks
PATCH  /api/tasks/:id                           Update task
```

#### Goals

```
POST   /api/companies/:id/goals                Create goal
GET    /api/companies/:id/goals                List goals (tree)
PATCH  /api/goals/:id                           Update goal
```

#### Messages

```
POST   /api/tasks/:id/messages                 Send message (as board)
GET    /api/tasks/:id/messages                 Get messages
```

#### Tools

```
POST   /api/companies/:id/tools                Register tool
GET    /api/companies/:id/tools                List tools
PATCH  /api/tools/:id                           Update tool
POST   /api/agents/:id/tools/:toolId           Assign tool to agent
DELETE /api/agents/:id/tools/:toolId           Remove tool from agent
GET    /api/companies/:id/tool-calls           Tool call history
```

#### Budgets & Costs

```
GET    /api/agents/:id/budgets                  Agent budget history
POST   /api/agents/:id/budgets                  Set budget
GET    /api/companies/:id/costs                 Cost breakdown (?period=day|week|month)
```

#### Governance

```
POST   /api/companies/:id/policies              Create policy
GET    /api/companies/:id/policies              List policies
PATCH  /api/policies/:id                        Update policy
GET    /api/companies/:id/approvals             List approvals (?status=pending)
POST   /api/approvals/:id/approve               Approve
POST   /api/approvals/:id/reject                Reject
```

#### Templates

```
GET    /api/templates/presets                    List preset templates
GET    /api/templates/presets/:filename         Get preset
POST   /api/templates/presets/:filename/import  Import preset
POST   /api/templates/import                     Import custom template
POST   /api/templates                            Save to template library
GET    /api/templates                            List saved templates
```

#### Integrations

```
POST   /api/companies/:id/integrations          Create integration
GET    /api/companies/:id/integrations          List integrations
PATCH  /api/integrations/:id                    Update integration
DELETE /api/integrations/:id                    Delete integration
POST   /api/integrations/:id/test               Test integration
GET    /api/integrations/:id/log                Integration log
```

#### Reports

```
POST   /api/companies/:id/reports/generate      Generate report on-demand
POST   /api/companies/:id/reports/scheduled     Create scheduled report
GET    /api/companies/:id/reports/scheduled     List scheduled reports
PATCH  /api/reports/scheduled/:id               Update scheduled report
GET    /api/reports/:id/history                 Report history
```

#### Audit & System

```
GET    /api/companies/:id/audit-log             Audit log (?limit=50)
GET    /api/health                               Health check
GET    /api/ws/stats                             WebSocket stats
```

### WebSocket

```javascript
const ws = new WebSocket('ws://localhost:3100/ws?company=<companyId>');

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  // msg.type: 'heartbeat.completed', 'approval.requested', etc.
  // msg.data: event payload
  // msg.timestamp: ISO string
};
```

#### Event Types

| Event | Description |
|-------|-------------|
| `connected` | WebSocket connection established |
| `heartbeat.completed` | Agent finished a heartbeat cycle |
| `approval.requested` | Agent needs board approval |
| `approval.approved` | Approval granted |
| `approval.rejected` | Approval denied |
| `agent.auto_paused` | Agent auto-paused by safety system |

---

## 🛡️ Safety System

Autonomiczne Biuro includes multiple safety mechanisms to prevent runaway agents:

| Protection | Default Limit | What Happens |
|-----------|---------------|--------------|
| Heartbeat rate | 60/hour | Agent auto-paused |
| Tool calls per task | 100 | Task blocked |
| Delegation depth | 5 levels | Task blocked |
| Message flood | 20/minute | Agent auto-paused |
| Consecutive errors | 5 | Agent auto-paused |
| Task duration | 24 hours | Task blocked |
| Circular delegation | — | Agent auto-paused + task blocked |
| Budget exceeded | per-agent monthly | Agent skipped |
| Integration errors | 10 consecutive | Integration auto-disabled |

All safety events are:
- Logged in audit log
- Broadcast via WebSocket
- Dispatched to integrations (Slack/Discord/etc.)
- Visible in dashboard

---

## 🔐 Authentication & RBAC

When `AUTH_ENABLED=true`, the system supports:

### Roles

| Role | Capabilities |
|------|-------------|
| **Owner** | Full access to everything |
| **Admin** | Manage agents, tasks, tools, policies, integrations. Can't delete company. |
| **Member** | Create agents/tasks/goals. Read tools/policies. |
| **Viewer** | Read-only access to everything |

### Per-Company Roles

A user can have different roles in different companies:
- Owner of "AI Startup"
- Viewer of "Content Agency"

### API Keys

For programmatic access (CLI, scripts, CI/CD):

```bash
# Create an API key via dashboard or API
curl -X POST /api/auth/api-keys \
  -H "Authorization: Bearer <session-token>" \
  -d '{"name": "CLI Key"}'
# Returns: { "key": "biuro_abc123...", "prefix": "biuro_ab" }

# Use it
export BIURO_TOKEN=biuro_abc123...
biuro status
```

---

## 🔌 Integrations

### Slack

```bash
curl -X POST /api/companies/$CID/integrations \
  -H "Content-Type: application/json" \
  -d '{
    "type": "slack",
    "name": "Team notifications",
    "config": {
      "webhook_url": "https://hooks.slack.com/services/T.../B.../xxx"
    },
    "events": ["task.completed", "approval.requested", "agent.auto_paused"]
  }'
```

### Discord

```bash
curl -X POST /api/companies/$CID/integrations \
  -d '{
    "type": "discord",
    "name": "Dev updates",
    "config": {
      "webhook_url": "https://discord.com/api/webhooks/123/abc"
    },
    "events": ["heartbeat.completed"]
  }'
```

### Webhook (with HMAC)

```bash
curl -X POST /api/companies/$CID/integrations \
  -d '{
    "type": "webhook",
    "name": "Custom endpoint",
    "config": {
      "url": "https://your-app.com/webhooks/biuro",
      "secret": "your-hmac-secret"
    },
    "events": []
  }'

# Incoming webhook has X-Biuro-Signature header:
# X-Biuro-Signature: sha256=<hmac-of-body>
```

### Email (via Resend)

```bash
curl -X POST /api/companies/$CID/integrations \
  -d '{
    "type": "email",
    "name": "Daily digest",
    "config": {
      "service": "resend",
      "api_key": "re_...",
      "from": "biuro@yourdomain.com",
      "to": ["you@example.com"]
    },
    "events": ["report.generated"]
  }'
```

### Available Events

```
heartbeat.completed    # Agent finished work cycle
task.created          # New task created
task.completed        # Task marked done
agent.hired           # New agent added
agent.terminated      # Agent removed
agent.auto_paused     # Safety system paused agent
approval.requested    # Agent needs approval
approval.approved     # Approval granted
approval.rejected     # Approval denied
budget.exceeded       # Agent hit budget limit
report.generated      # Scheduled report ready
tool.success          # Tool call succeeded
tool.error            # Tool call failed
tool.denied           # Tool call denied (permissions)
```

---

## 📊 Reports

### On-Demand

```bash
# Generate a daily summary
curl -X POST /api/companies/$CID/reports/generate \
  -d '{"type": "daily_summary", "period_days": 1}'

# Returns JSON data + formatted markdown
```

### Scheduled

```bash
# Daily summary at 9 AM, sent to Slack
curl -X POST /api/companies/$CID/reports/scheduled \
  -d '{
    "name": "Morning Brief",
    "type": "daily_summary",
    "schedule": "0 9 * * *",
    "format": "markdown"
  }'
```

### Report Contents

Reports include:
- **KPIs**: Total cost, tasks created/completed, heartbeats, tool calls, approvals
- **Per-agent performance**: Heartbeats, tasks done, cost, budget usage
- **Recently completed tasks**: With results
- **Issue detection**: Paused agents, budget warnings, blocked tasks, pending approvals

---

## 🧪 Testing

```bash
# Run all tests
pnpm --filter @biuro/server test

# Run CLI smoke tests
pnpm --filter @biuro/cli test

# Run dashboard tests (includes API-backed auth/dashboard flow)
pnpm --filter @biuro/dashboard test

# Watch mode
pnpm --filter @biuro/server test:watch
```

Tests cover:
- Company CRUD and cascade delete
- Atomic task checkout (no double-work)
- Budget enforcement
- Delegation depth detection
- Safety system triggers
- Route-level API behavior (`companies`, `agents`, `tasks`, `tools`, `templates`, `integrations`)
- WebSocket auth and scheduler integration flows
- Runtime parsing for Claude, OpenAI, and Gemini
- CLI smoke flows (`login -> status` auth persistence, `deploy` template import)
- Lightweight API + dashboard E2E flow (UI login, session persistence, company hydration, protected dashboard bootstrap)

---

## 🐳 Docker Deployment

### Development

```bash
# Start only PostgreSQL in Docker, run app locally
docker compose up -d postgres
pnpm dev
```

### Production

```bash
# Build and run everything
docker compose up -d --build

# Scale (if needed)
docker compose up -d --scale server=2
```

### Environment for Docker

```bash
# Create .env file
cp .env.example .env
# Add your API keys to .env

# Launch
docker compose up -d
```

### Observability Stack

Prometheus, Grafana, OpenTelemetry Collector, and Tempo are included in `docker-compose.yml`.

```bash
# Start the full stack
docker compose up -d

  # Metrics
  # API:        http://localhost:3100/metrics
  # Worker:     http://localhost:9464/metrics
  # Prometheus: http://localhost:9090
  # Grafana:    http://localhost:3001
  # Tempo:      http://localhost:3202
  ```

Grafana ships with a pre-provisioned `Autonomiczne Biuro Overview` dashboard, Prometheus scrapes both the API server and worker out of the box, and traces flow through the local OpenTelemetry Collector into Tempo.

The Docker stack defaults `OTEL_EXPORTER_OTLP_ENDPOINT` to the in-cluster collector:

```bash
http://otel-collector:4318/v1/traces
```

For external distributed tracing, set `OTEL_EXPORTER_OTLP_ENDPOINT` in `.env` to an OTLP HTTP traces endpoint such as:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://tempo:4318/v1/traces
```

### Tailscale (for solo entrepreneurs)

Access your Biuro instance from your phone:

```bash
# On your server
tailscale up
# Your machine gets a Tailscale IP

# Access dashboard from phone:
# http://<tailscale-ip>:3200
```

---

## 🤔 FAQ

### What does a typical setup look like?

Locally, a single Node.js process manages a PostgreSQL database and local file storage. For production, deploy however you like — Docker, Vercel, fly.io, bare metal. Configure agents, goals, and tools — the agents take care of the rest.

### Can I run multiple companies?

Yes. A single deployment can run an unlimited number of companies with complete data isolation. Each company has its own agents, tasks, goals, tools, budgets, policies, and audit trail.

### How is this different from agents like Claude Code or Codex?

Autonomiczne Biuro *uses* those agents. It orchestrates them into a company — with org charts, budgets, goals, governance, and accountability. Think of it as the difference between an employee and a company.

### Why not just use Asana or Trello?

Agent orchestration has subtleties: coordinating who has work checked out, maintaining sessions across heartbeats, monitoring costs, establishing governance, detecting loops. Autonomiczne Biuro handles all of this out of the box.

### Do agents run continuously?

By default, agents run on scheduled heartbeats (every 30 seconds by default). Each heartbeat, they check for assigned work, execute it, and report results. You can adjust `HEARTBEAT_INTERVAL_MS` to control frequency.

### How much does it cost to run?

Only the LLM API costs. Each heartbeat consumes tokens (typically $0.001–$0.01 per heartbeat depending on context size). Set monthly budgets per agent to control costs. A small team of 5 agents running at 2 heartbeats/minute costs roughly $5–15/day.

### Is it secure?

- **Secrets** are scrubbed from template exports
- **RBAC** controls who can do what (when enabled)
- **API keys** are stored as hashes (never in plaintext)
- **Tool execution** has permission checks, rate limits, and domain whitelists
- **Bash tools** have command whitelists
- **File tools** have path traversal protection
- **Webhook signatures** use HMAC-SHA256

### Can I add custom runtimes?

Yes. Implement the `AgentRuntime` interface:

```typescript
interface AgentRuntime {
  name: string;
  execute(context: AgentContext): Promise<AgentResponse>;
}
```

Register it in `src/runtimes/registry.ts`.

### Can I add custom tools?

Yes. Three ways:

1. **Built-in**: Add a function to `src/tools/builtin/`
2. **HTTP**: Register an API endpoint as a tool (no code needed)
3. **Bash**: Register a shell command (with whitelist)

### What databases are supported?

PostgreSQL 16+. The schema uses `pgcrypto` for UUID generation and `FOR UPDATE SKIP LOCKED` for atomic task checkout.

---

## 🗺️ Roadmap

- [ ] **Bring-your-own-ticket-system** — Sync with Jira, Linear, GitHub Issues
- [ ] **MCP integration** — Native Model Context Protocol support
- [ ] **Agent marketplace** — Share and discover agent configurations
- [ ] **Visual workflow builder** — Drag-and-drop task pipelines
- [ ] **Real-time code execution** — Sandboxed code runners for developer agents
- [ ] **Advanced analytics** — Cost trends, productivity metrics, agent rankings
- [ ] **Multi-user collaboration** — Real-time presence, comments, mentions
- [ ] **Mobile app** — Native iOS/Android app
- [ ] **Plugin system** — Extend with custom modules
- [ ] **Clipmart** — One-click company templates marketplace

---

## 🏛️ What Autonomiczne Biuro is NOT

| Not this | But this |
|----------|----------|
| Not a chatbot | Agents have **jobs**, not chat windows |
| Not an agent framework | We don't tell you how to build agents. We tell you how to **run a company** made of them |
| Not a workflow builder | No drag-and-drop pipelines. We model **companies** — with org charts, goals, budgets, and governance |
| Not a prompt manager | Agents bring their own prompts, models, and runtimes. We manage the **organization** they work in |
| Not a single-agent tool | This is for **teams**. If you have one agent, you probably don't need this. If you have twenty — you definitely do |
| Not a code review tool | We orchestrate **work**, not pull requests. Bring your own review process |

---

## 📄 License

MIT

---

<div align="center">

**Built for the era of autonomous AI companies.**

🏢 Autonomiczne Biuro

[GitHub](https://github.com/your-org/autonomiczne-biuro) · [Documentation](#) · [Discord](#)

</div>
