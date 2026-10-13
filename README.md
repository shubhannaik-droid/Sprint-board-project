# Sprintboard – Agile Task Manager

A small Scrum/Kanban web app built with HTML, CSS, JavaScript, and a small Node server for the AI assistant.

## Run it

Run the app through its local server so the AI assistant can reach the private API proxy:

    # PowerShell
    $env:GROQ_API_KEY = "your-groq-api-key"
    npm start

Then visit http://localhost:8000. The main board still works without a key; AI chat requires `GROQ_API_KEY`.

The AI can answer questions, read selected project files, and propose board or file changes. Each proposed change needs a separate approval in the chat panel. Project file access is limited to the allowlist in `server.js`. Never put the API key in browser code or commit it to the repository.

## What it shows

| Agile concept | Where in the app |
|---|---|
| User stories ("As a… I want… so that…") | New user story dialog |
| Story points & priority | Fibonacci-style points (1–13), High/Medium/Low |
| Product backlog | **Backlog** tab, sorted by priority |
| Sprint planning | **Sprints** tab: create a sprint, add stories from the backlog, start it |
| Kanban board | **Sprint board** tab: To Do / In Progress / Done, drag & drop or use the arrow buttons |
| Burndown chart | Under the board: remaining points vs ideal pace |
| Live burndown | Actual remaining work, WIP points, scope changes, and a pace-based finish estimate |
| Daily streak | Top of the **Sprint board** tab: consecutive working days with at least one story moved to Done, best streak, and a 14-day activity strip. Weekends never break it |
| Sprint review & velocity | Complete a sprint; unfinished stories return to the backlog, and average velocity updates |
| Team workspaces | Create an account, share projects by invite link, assign stories, comment with @email mentions, and review project activity |

Team workspaces use the Node server and a persistent SQLite database. Run the app with Node 22.13 or newer using `npm start`, then choose **Sign in** to create an account. Invite links can be restricted to an email address and expire after seven days. In Docker, the `sprintboard-data` volume preserves accounts and project data across container rebuilds.

## Try the workflow

1. Open the app (sample data loads on first run).
2. Drag a card from To Do to In Progress to Done, and watch the progress bar and burndown update.
3. In **Backlog**, use "Add to sprint…" to pull a story into the sprint.
4. In **Sprints**, select **Complete sprint**, then create and plan Sprint 2.

## DevOps pipeline (mini project)

The repo also implements an end-to-end DevOps pipeline:
Development → Git/GitHub → CI → Tests → Docker → CD → Running app → Monitoring & feedback.

    npm install && npm test          # automated tests
    $env:GROQ_API_KEY = "your-groq-api-key"
    docker compose up -d --build     # run in a container at http://localhost:8080
    scripts/healthcheck.sh           # check the running app

See [docs/DEVOPS.md](docs/DEVOPS.md) for the stage-by-stage mapping, GitHub setup, and deployment secrets.

![Pipeline flowchart](docs/pipeline-flowchart.png)

## Project structure

    sprintboard/
    ├── index.html                     page layout and dialogs
    ├── css/style.css                  styling
    ├── js/app.js                      state, rendering, drag & drop, localStorage
    ├── tests/app.test.js              automated tests (stage 4)
    ├── Dockerfile, nginx/             container image + web server config (stage 5)
    ├── docker-compose.yml             one-command local/server run
    ├── .github/workflows/ci-cd.yml    GitHub Actions: CI, tests, Docker, CD (stages 3-7)
    ├── .github/                       PR + feedback issue templates (stages 2, 8)
    ├── scripts/healthcheck.sh         post-deploy check (stages 7-8)
    ├── docs/                          DEVOPS.md and the flowchart
    └── package.json

## Notes

- Signed-out boards are stored in the browser's `localStorage`. Signed-in project boards, accounts, comments, memberships and activity are stored by the server in SQLite. Use **Export JSON** in the footer to back up board data.
- Burndown movement history is stored separately in `localStorage` so reopening a finished story can show the line moving back up.
- Only one sprint can be active at a time.
