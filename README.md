# Crewboard

[Русская версия](README.ru.md)

A local desktop app for projects, tasks, and Markdown documents. Data lives in ordinary files
in a folder you choose. No account, server, or internet connection is required for everyday use.
A dedicated CLI lets local agents claim tasks and submit work reports.

## Features

- Projects with cover images, renaming, and a separate source code folder.
- A **Not started → In progress → Done** Kanban board with drag-and-drop task ordering.
- Permanent task codes such as `TT-24`, update timestamps, Markdown descriptions, and acceptance criteria.
- Colored labels and filters matching any selected label or unlabeled tasks.
- A task archive that restores tasks to their original column. Deletion is a separate action.
- Multiple project documents: create, rename, and reorder tabs.
- Link external `.md` files and edit the originals without copying them into the project folder.
- A CodeMirror editor, Markdown preview, side-by-side mode, and autosave.
- External document change detection and save conflicts that preserve edits in the editor.
- A shared list of people and agents, task assignments, sessions, questions, and Markdown reports via CLI.
- **RU / EN** switching in the top-right toolbar and initial setup screen. The choice is saved locally;
  dates and task counts follow the selected language. Project names and content stay as entered.

Stack: **Tauri 2 / Rust**, **React 19 / TypeScript / Vite**, dnd-kit, CodeMirror, and markdown-it.
The current installer configuration targets Windows with NSIS.

## Development prerequisites

- Node.js compatible with the current Vite version: `^20.19.0 || >=22.12.0`, and npm.
- Rust stable and Cargo; use the MSVC toolchain on Windows.
- On Windows, Microsoft C++ Build Tools with **Desktop development with C++**, and WebView2 Runtime.

See the [official Tauri prerequisites](https://v2.tauri.app/start/prerequisites/#windows)
for installation instructions. These tools are required to develop and build from source.

## Run from source

Clone the repository and open a terminal at its root. Run all commands below from that folder.

```bash
npm ci
npm run tauri dev
```

Tauri starts Vite and opens the desktop window. Choose a data folder on first launch.
Installing dependencies and the first build may require network access.

`npm run dev` starts only the frontend at `http://localhost:1420`.
Local file operations use the Tauri API, so use `npm run tauri dev` for the full app.

## Build an installer

```bash
npm run tauri build
```

This generates icons from `app-icon.png`, checks TypeScript, and builds the frontend and native app.
The Windows installer is written to `src-tauri/target/release/bundle/nsis/`.

Run individual checks with:

```bash
npx tsc --noEmit
npx vite build
npm run test:i18n
cargo test --manifest-path src-tauri/Cargo.toml --locked
```

`npm run build` builds the frontend and generates icons. `npm run preview` serves that build without a native window.

## First steps

1. Choose a data folder and create a project.
2. Add tasks on the Board tab, then set labels, assignees, and acceptance criteria.
3. Use the add-document button to create a document or link an existing Markdown file.
4. For agent work, select the project's source code folder and follow the [CLI guide](docs/agent-workflow.md).

Changes are saved automatically. Task descriptions and documents are saved about half a second
after typing; pending edits are also flushed when closing the view.
`Ctrl+S` in the Markdown editor saves immediately. `Esc` closes the task panel or open menu.

Linked Markdown files are edited in place. Unlinking a tab leaves the original file on disk.
Deleted internal documents and projects go to the Windows Recycle Bin.

## Data storage

Choose the data folder in the app. It can be separate from this repository and project source folders.
After reinstalling the app, select the existing data folder to access your projects again.

The selected path is stored separately: on Windows, in `%APPDATA%/com.local.tasktrack/config.json`.
An example populated data folder:

```text
<data-dir>/
  participants.json            shared participants
  participants.lock            participant list lock
  projects/
    my-project/
      project.json             name, creation date, cover, sourceDir
      board.json               columns, labels, task numbers, sessions, reports
      board.lock               board lock
      documents.json           document names, order, and paths
      doc-<timestamp>.md       internal document
      README.md                legacy document, if already present
      cover-<timestamp>.<ext>  copied cover image
```

Files are created as features are used. New projects do not receive a document automatically.
An existing `README.md` is imported as “Обзор проекта” when the document list is first read.
You can rename it like any other document. Document names stay exactly as saved in both interface languages.

- The project folder name is its permanent ID; renaming changes the display name.
- `sourceDir` points to project code, separate from the tracker's data folder.
- `board.json` contains `todo`, `inProgress`, `done`, `labels`, `taskPrefix`, and `nextTaskNumber`.
  Array order determines column order. Archived tasks stay in their original column.
- Linked documents have an `externalPath` in `documents.json`; content stays at its original location.
- Relative images such as `![](screens/menu.png)` resolve from the Markdown file's own folder.

Back up the data folder together with any linked documents and their images.
There is no built-in cloud sync. Use the app or CLI for task operations instead of editing
`board.json` manually while the app is running.

The app and CLI use interprocess locks and merge independent board changes.
If the same field changes concurrently, the app reports a conflict and keeps local edits in the window.
The interface language is a local preference in WebView storage, independent of project data.
On first use it follows the system language: Russian for `ru`, English otherwise.
Diagnostic messages from Rust and the agent CLI remain in English in both interface languages.

## Working with agents

Build the CLI separately from the desktop app:

```powershell
npm run agent:build
npm run agent -- --help
```

For direct PowerShell invocation from the repository root:

```powershell
$tt = Join-Path (Get-Location).Path "src-tauri/target/debug/crewboard-cli.exe"
& $tt --help
```

Regular commands write JSON to stdout and errors to stderr. The CLI uses the configured data folder;
pass `--data-dir PATH` before the command to choose another one. Running through npm may add npm output.

Workflow: **claim → work in sourceDir → report → submit**. A claim returns a token required for
reports, questions, and submission. `submit` marks the task as ready for review and keeps it
In progress. The user moves it to Done after reviewing. Assigning a participant or invoking the CLI
does not start an agent process.

See the [agent workflow guide](docs/agent-workflow.md) for commands, stdin reports, and interrupted-session recovery
([по-русски](docs/agent-workflow.ru.md)).

## Source layout

| Path | Purpose |
|---|---|
| `src-tauri/src/lib.rs` | Settings, data folder selection, atomic writes, command registration |
| `src-tauri/src/projects.rs` | Projects and cover images |
| `src-tauri/src/board.rs`, `board_merge.rs` | Board validation, storage, and concurrent edit merging |
| `src-tauri/src/docs.rs` | Internal and linked documents, tab order, conflict detection |
| `src-tauri/src/agents.rs`, `agent_cli.rs` | Participants, source folders, and agent workflow commands |
| `src-tauri/src/storage.rs` | Interprocess locks |
| `src-tauri/src/bin/crewboard-cli.rs`, `scripts/crewboard-cli.mjs` | CLI entry point and npm wrapper |
| `src/App.tsx`, `src/components/ProjectPage.tsx` | Data folder selection, projects, document tabs |
| `src/components/Board.tsx`, `TaskPanel.tsx`, `TaskArchive.tsx` | Board, task panel, and archive |
| `src/components/LabelPicker.tsx`, `LabelManager.tsx`, `LabelFilter.tsx` | Labels and filters |
| `src/components/Docs.tsx`, `MarkdownEditor.tsx`, `src/markdown.ts` | Editor, preview, and Markdown handling |
| `src/i18n.ts`, `src/locales.ts`, `src/components/LanguageSwitcher.tsx` | Language preference, translations, RU/EN controls |
| `src/taskMetadata.ts`, `src/saveTracker.ts` | Task dates, archiving, and save tracking |
| `docs/agent-workflow.md` | User and local-agent instructions |

## License

MIT — see [LICENSE](LICENSE).
