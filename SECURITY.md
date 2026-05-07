# Security Policy

## Supported Versions

Security fixes are considered for:

- The latest published npm version of `@hi-man/himan`.
- The current `master` branch before the next npm release.

Older versions may receive fixes only when the issue is severe and the patch can be applied safely.

## Reporting a Vulnerability

Please do not disclose security vulnerabilities in a public issue.

Preferred reporting path:

1. Use GitHub private vulnerability reporting for this repository if it is enabled.
2. If private reporting is not available, open a minimal public issue asking maintainers to provide a private contact path. Do not include exploit details, secrets, private repository URLs, tokens, or proof-of-concept payloads in that issue.

When reporting, include:

- Affected `himan` version or commit.
- Operating system and Node.js version.
- A minimal description of the affected command or workflow.
- Impact, prerequisites, and whether credentials or private Git remotes are involved.
- Safe reproduction notes, without exposing secrets.

## Response Expectations

Maintainers will try to acknowledge valid reports within 7 days. Fix timing depends on severity, reproducibility, and release risk.

After a fix is available, the issue should be documented in [CHANGELOG.md](./CHANGELOG.md) unless disclosure would create avoidable risk for users.

## Scope

Security-relevant areas include:

- Git source cloning, fetching, publishing, and tag handling.
- Filesystem writes under project directories and `~/.himan`.
- Symlink and copy install modes.
- Parsing resource metadata from `himan.yaml`.
- Handling credentials or private repository URLs passed through Git remotes.

Out of scope:

- Vulnerabilities in third-party agent tools after resources are installed.
- Issues requiring arbitrary local filesystem write access before running `himan`.
- Social engineering or attacks against npm, GitHub, or Git hosting providers outside this package.
