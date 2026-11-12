# Working with agents: first stage

[Русская версия](agent-workflow.ru.md) · [Project README](../README.md)

Crewboard stores shared tasks for Codex, Claude, and other local agents. The user starts the agent
in its own application. Assigning a participant does not launch anything automatically.

## Setup

1. Open **Participants** in the top bar. The default entries are “Я”, Codex, and Claude.
   Add people or agents for all projects in the selected data folder. Each entry shows its ID.
2. Open a project and select **Choose folder** in the sources row. This is the code folder,
   separate from the tracker's data folder.
3. Choose an assignee in the task and fill in **Acceptance criteria**. The Agent label is optional
   and does not assign a participant.
4. Build the CLI with `npm run agent:build` from the Crewboard repository root.

Use **RU / EN** at the right of the top bar to change the interface language. The choice persists locally.
The examples below use English UI labels; stored project names and participant names are not translated.

## Invocation

From the application repository:

```powershell
npm run agent -- --help
npm run agent -- projects list
npm run agent -- participants list
npm run agent -- tasks list --project task-track --assignee codex --status todo
npm run agent -- tasks show TT-24 --project task-track
```

Direct invocation is more convenient for agents: stdout contains only JSON, errors go to stderr,
and a failed command exits with code 1.

```powershell
$appDir = (Get-Location).Path # Crewboard repository root.
$tt = Join-Path $appDir "src-tauri/target/debug/crewboard-cli.exe"
& $tt projects list
& $tt tasks show TT-24 --project task-track
```

Initialize `$tt` from the repository root. The computed executable path remains usable after changing
into a task's source directory.

`--project` accepts a folder ID from `projects list`, rather than a display name.
Task codes are examples: replace TT-24 with your task. If multiple projects share a prefix,
pass `--project` to show, claim, report, ask, submit, and release.

The CLI uses the data folder configured in the app. To select another folder, place
`--data-dir "../crewboard-data"` before the command, for example:
`& $tt --data-dir "../crewboard-data" projects list`. Replace the example with your actual data folder.
Relative paths are resolved from the terminal's current directory. This option does not change app settings.
Use the same data folder for all commands in a session.

## Claim a task and return the result

```powershell
$lease = & $tt tasks claim TT-24 --project task-track --session codex-search-1 | ConvertFrom-Json
$token = $lease.token
# Work in sourceDir, then pass the report through stdin (--file -).
$OutputEncoding = [System.Text.UTF8Encoding]::new($false) # Preserve Unicode in Windows PowerShell 5.1.
$report = @'
## Changes
...
'@
$report | & $tt tasks report TT-24 --project task-track --session codex-search-1 --token $token --file -
& $tt tasks submit TT-24 --project task-track --session codex-search-1 --token $token
```

In bash, replace `& $tt` with the executable path and pass the report using a heredoc:
`"$TT" tasks report TT-24 ... --file - <<'EOF'` … `EOF`.

Do not create report files in the data or source folder. The report command copies the text into the task,
so no file needs to remain. If using a file is easier, write it to the temporary folder (`$env:TEMP`)
and delete it after reporting. Text must be UTF-8.

Every session needs a unique name. Keep the token returned by claim; ordinary show/list responses do not expose it.

- **claim** atomically assigns the task to the session and moves it to In progress.
  Another agent cannot claim an occupied task. Claude cannot claim a task assigned to Codex.
- Without `--agent`, claim uses the task's assignee, who must be an agent. For an unassigned task,
  pass `--agent ID`. A mismatch produces an error identifying the required participant ID.
- **report** adds a Markdown report separately from the original description. Include changes,
  checks, limitations, commits, and file paths. A report does not replace requirements.
- **submit** requires a report for the current claim and marks the task **Ready for review**.
  Its status stays In progress.
- The user reviews the result and moves the task to Done. The active session closes and reports remain.
- Questions are discussed in the agent chat; the tracker stores the question and the work result.

## Creating tasks from an agent

```powershell
& $tt tasks create --project task-track --title "Fix search" --description-file "./description.md" --criteria-file "./criteria.md" --assignee codex --label Bug
```

Prepare `description.md` and `criteria.md` in the current terminal directory, or pass their actual paths.
One file can be read from stdin by passing `-` instead of a path.

This creates a regular Not started task with a new permanent number. Assignment and label are optional.
`--label` accepts an existing label ID or name.

## Questions and release

```powershell
& $tt tasks ask TT-24 --project task-track --session codex-search-1 --token $token --message "Which fields should search include?"
& $tt tasks release TT-24 --project task-track --session codex-search-1 --token $token
```

ask displays **Needs an answer**. submit and release clear the question.
release returns an unfinished task to Not started while preserving its assignee and reports.

If the agent stops and its token is lost, the user can select **Release task** in the task panel
or recover manually:

```powershell
& $tt tasks release TT-24 --project task-track --force
```

The previous token is invalid after release. Before releasing a running session, stop its work in chat
so it does not keep modifying source files. These commands manage tasks, not Codex or Claude processes.

## Shared participants and source folders through CLI

```powershell
& $tt participants add --name "Reviewer" --kind human
& $tt projects set-source --project task-track --path $appDir
```

This example uses the Crewboard repository root stored in `$appDir` as the sources for the task-track project.
For another project, pass its ID and source directory.

## Saving and concurrent work

The app and CLI share saving code and interprocess locks. Independent changes are merged; for example,
a local description edit preserves an agent report. When the same field changes concurrently, the app
reports a conflict and keeps local edits in the window. Copy them, retry saving, or explicitly load the current board.

The board refreshes roughly every two seconds when no save or drag operation is in progress.
Do not edit board.json manually for agent operations; use the CLI.

Participants and sourceDir organize local work; they are not authenticated accounts.
All processes run with the user's permissions. There is no MCP server, cloud API,
automatic agent launching, or task queue.

## Example prompt for the agent chat

Replace `<cli-path>` with `$tt` and `<data-folder>` with the selected data folder.
Substitute your project ID and task code. The assignee can be omitted because claim reads it from the task.

> Use the Crewboard CLI at <cli-path> with --data-dir <data-folder>. Read TT-24 in project task-track and claim it with a unique session name. Work in sourceDir from the response. Do not edit board.json directly. After finishing, pass a Markdown report to report through stdin (`--file -`) without creating files, then submit the task for review using submit. If anything is unclear, use ask and ask me in this chat. Do not move the task to Done.
