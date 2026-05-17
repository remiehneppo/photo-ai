# Issue tracker: GitHub

Issues and PRDs for this repo live as GitHub issues. Use `gh` CLI for all operations.

## Conventions

- **Create issue**: `gh issue create --title "..." --body "..."`. Use heredoc for multi-line bodies.
- **Read issue**: `gh issue view <number> --comments`, filtering comments by `jq` and also fetching labels.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

Infer repo from `git remote -v` — `gh` does this automatically when run inside clone.

## When a skill says "publish to the issue tracker"

Create GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.
