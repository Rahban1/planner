# Planner documentation

Planner is a task manager that can give work to an external software agent. The web application stores projects, tasks, plans, files, users, and run records. The agent runner reads queued work, starts OpenHands, and sends results back to Planner.

These documents use ASD-STE100 Simplified Technical English. Technical names stay unchanged when the source code or a service uses those names.

## Select a document

| Document                              | Use it to                                                                          |
| ------------------------------------- | ---------------------------------------------------------------------------------- |
| [Getting started](GETTING_STARTED.md) | Install Planner and get a local result.                                            |
| [Architecture](ARCHITECTURE.md)       | Understand the components, data flows, and design decisions.                       |
| [Operations](OPERATIONS.md)           | Run the agent services, manage the database, deploy, and solve common problems.    |
| [Technical reference](REFERENCE.md)   | Find routes, server functions, data tables, settings, commands, and status values. |

## Product functions

Planner has these primary functions:

- Create projects with one to eight GitHub repository URLs.
- Create tasks and subtasks with notes, priority, due date, and status.
- Put all open top-level tasks in one priority list.
- Upload task files with a maximum size of 10 MB for each file.
- Start an implementation run or a plan run.
- Review a plan, request a revision, and approve a plan.
- Ask project members for plan approval and plan suggestions.
- Show agent logs and pull request state.
- Mark a task as done after all required pull requests merge.
- Sign in with Google, GitHub, or a configured Cloudflare Access identity.

## System boundary

The repository contains two runtime systems:

1. The Planner Worker contains the React user interface, server functions, HTTP routes, D1 access, and R2 access.
2. The local Docker stack contains the Node.js runner and the OpenHands Agent Server.

Planner does not run the software agent inside the Cloudflare Worker. The runner uses the `/api/runner/*` bridge to exchange data with the Worker.

## Read next

Start with [Getting started](GETTING_STARTED.md). Read [Architecture](ARCHITECTURE.md) before you change data flow, authentication, or agent-run behavior.
