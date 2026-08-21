# PR Queue

PR Queue is a small GitHub App-backed review queue for an organization. It tracks configured repositories and shows pull requests in the order they became ready for review.

## Behavior

- Draft pull requests are not queued.
- A non-draft pull request enters on `opened`, `ready_for_review`, `reopened`, or when a link is shared in a monitored Slack channel.
- A closed or merged pull request leaves the queue.
- A pull request remains queued after approval or requested changes.
- A new commit after a review, or a new review request, moves the pull request to the bottom once per head SHA.
- Repositories can be excluded in `config/queue.yaml`.
- CI checks, GitHub Actions, commit statuses, current review state, requested reviewers, and branch-rule requirements are stored as current state.
- Existing pull requests are not imported when the service starts.

## Local setup

Requirements: Node.js 22 and PostgreSQL 15 or newer.

```sh
cp .env.example .env
npm install
npm run dev
```

The API is available at `http://localhost:3000`. Run the frontend separately with `npx vite` during local development, or build the client and run the production server:

```sh
npm run build
NODE_ENV=production npm start
```

The production server serves the built React app and exposes the webhook at `/github/webhook` and Slack events at `/slack/events`.

## Docker Compose

Docker Compose builds the app image, starts PostgreSQL, waits for PostgreSQL to become healthy, and starts the app. The app runs its schema migration on startup:

```sh
cp .env.example .env
# Set GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, GITHUB_WEBHOOK_SECRET,
# SLACK_BOT_TOKEN, and SLACK_SIGNING_SECRET in .env.
docker compose up --build
```

The queue is available at `http://localhost:3000`. PostgreSQL data persists in the `postgres-data` volume. Stop the services with `docker compose down`; add `-v` only when intentionally deleting the database.

Set `DATABASE_URL` explicitly in `.env` if `POSTGRES_PASSWORD` contains characters that need URL encoding.

## Configuration

Edit `config/queue.yaml`, then redeploy:

```yaml
organization: example-org

repositories:
  - example-org/frontend
  - example-org/backend

slack_channels:
  - C1234567890
  - C0987654321

slack_reactions:
  success: ":white_check_mark:"
  failure: ":x:"
```

`repositories` is optional. Omitting it or setting it to an empty array includes all repositories in the organization. Repository names must belong to the configured organization.

`slack_channels` is optional. Omitting it or setting it to an empty array monitors all channels the bot is invited to.

`slack_reactions` is optional. Defaults are `:white_check_mark:` for success and `:x:` for failure.

Configuration changes do not backfill previously ignored pull requests.

## GitHub App

Create an organization-installed GitHub App with these read permissions:

- Repository metadata
- Pull requests
- Checks
- Commit statuses
- Actions
- Administration (to read effective branch rules)

Subscribe to these events:

- Pull request
- Pull request review
- Check run
- Check suite
- Workflow run
- Commit status

GitHub App installation and repository-selection events are received automatically. Configure the webhook URL as `https://your-host.example/github/webhook` and set a webhook secret. The network layer should expose this endpoint publicly while protecting the queue UI through your existing WARP setup.

## Slack App

Create a Slack app using the manifest in `docs/slack-app-manifest.json` and install it to your workspace. The app needs the following bot token scopes:

- `channels:history`
- `groups:history`
- `chat:write`
- `reactions:write`
- `channels:read`
- `groups:read`
- `mpim:history`
- `im:history`

Subscribe to these bot events:

- `message.channels`
- `message.groups`
- `message.im`
- `message.mpim`

Configure the Request URL as `https://your-host.example/slack/events`.

## Secrets

Set these secrets through your deployment platform or Secret Manager:

- `GITHUB_APP_ID`
- `GITHUB_APP_PRIVATE_KEY`
- `GITHUB_WEBHOOK_SECRET`
- `DATABASE_URL`
- `SLACK_BOT_TOKEN`
- `SLACK_SIGNING_SECRET`

`GITHUB_APP_PRIVATE_KEY` may contain literal newlines or escaped `\\n` sequences.

## Cloud SQL

Start the service normally against the target `DATABASE_URL`. The app runs its schema migration on startup. Cloud SQL is the source of truth. Memorystore is intentionally not required for this workload; webhook delivery retries and queue ordering are database-backed.

## Verification

```sh
npm run typecheck
npm test
npm run build
```
