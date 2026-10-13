# DevOps pipeline for Sprintboard

This project follows the mini-project flowchart:

**Development -> Git/GitHub -> CI -> Testing -> Docker -> CD -> Running application -> Monitoring & feedback -> Continuous improvement**

![Pipeline flowchart](pipeline-flowchart.png)

## Where each stage lives

| # | Stage | What happens | Files |
|---|-------|--------------|-------|
| 1 | Development | Build the app and make changes locally | `index.html`, `css/`, `js/app.js` |
| 2 | Version control | Commit and push changes to GitHub | Git and `.github/pull_request_template.md` |
| 3 | Continuous integration | GitHub Actions installs dependencies and checks JavaScript syntax | `.github/workflows/ci-cd.yml`, job `build-and-test` |
| 4 | Automated testing | The pipeline runs the Sprintboard UI tests; failure stops later jobs | `tests/app.test.js` |
| 5 | Containerization | Build a Node Docker image, tag it with the commit, and publish it to GHCR | `Dockerfile`, job `docker` |
| 6 | Continuous deployment | After tests and image publishing pass on `main`, trigger Render to deploy that commit's image | job `deploy` |
| 7 | Running application | The pipeline checks `/health` and verifies `/version.json` reports the deployed commit | `server.js`, job `deploy` |
| 8 | Monitoring & feedback | Check Render logs and health; turn reported issues into backlog stories | Render dashboard, `.github/ISSUE_TEMPLATE/feedback.md` |

Feedback becomes new user stories in Sprintboard and starts the improvement cycle again.

## Run locally

```powershell
npm ci
npm run lint
npm test
npm start
```

Open `http://localhost:8000`. To run the container locally instead:

```powershell
docker compose up -d --build
bash scripts/healthcheck.sh
```

The Docker Compose app is available at `http://localhost:8080`.

## GitHub Actions flow

On pull requests, Actions installs dependencies, runs lint and tests, and builds the image without publishing it. On pushes to `main`, it runs those same checks, publishes the Docker image to GitHub Container Registry with a commit tag and `latest`, then deploys the commit-tagged image to Render. The final job waits for `/health` and checks that `/version.json` contains the current commit SHA.

## Configure Render for the demo

1. In Render, create a **Web Service** and choose **Existing Image**. Enter `ghcr.io/shubhannaik-droid/sprint-board-project:latest`, choose the Free plan, and set the health check path to `/health`. Add the environment variable `PORT=10000` so the app listens on Render?s web-service port.
2. Make the GHCR container package public so Render can pull it without registry credentials. In GitHub, open the package settings and change package visibility to public. The source repository can remain private.
3. Copy the service?s **Deploy Hook** from Settings. Image-backed services do not auto-deploy when a registry tag changes; this workflow calls the hook only after CI, tests, and Docker publishing succeed.
4. Copy the service?s public `https://...onrender.com` URL.
5. In GitHub, open **Settings > Secrets and variables > Actions > New repository secret** and add:

   | Secret | Value |
   |--------|-------|
   | `RENDER_DEPLOY_HOOK` | Render service deploy hook URL |
   | `RENDER_APP_URL` | Render service public URL, without a trailing slash |

6. Push a small change to `main`, then open **Actions > CI/CD**. Show CI/tests, Docker publishing, Render deployment, and the successful smoke test. Open the Render URL and show the app.

Never put secret values in the repository or in chat. A Render free web service may sleep when idle, so open the app before the presentation and allow time for it to wake up. Free service files are ephemeral; this project is a demonstration, not a production data store.

## Monitoring and feedback

- `GET /health` returns `ok` and is used by the deployment smoke test.
- `GET /version.json` shows the running image's commit and build time.
- Use the Render dashboard's logs and service health to show runtime monitoring.
- Record issues in GitHub using the feedback issue template, then add them to the Sprintboard backlog.
