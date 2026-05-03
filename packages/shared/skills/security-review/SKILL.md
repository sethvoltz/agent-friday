---
description: Security audit of the pending changes on the current branch. Checks for OWASP Top 10 vulnerabilities, injection flaws, auth issues, secrets exposure, and unsafe dependencies.
when_to_use: When the user wants a security audit, before shipping a sensitive feature, when the word "security" is mentioned, or when changes touch auth, input handling, file I/O, or external APIs.
disable-model-invocation: false
user-invocable: true
scope: [builder]
---

Perform a security review of the changes on the current branch.

## Steps

1. Run `git diff main...HEAD` to see all changed code. If a specific file or directory was provided as an argument, focus the review there.
2. For each changed file, scan for:

   **Injection & input handling**
   - SQL injection (unsanitized user input in queries)
   - Command injection (user input in shell commands, `exec`, `spawn`)
   - Path traversal (user-controlled paths without canonicalization)
   - XSS (unescaped user content in HTML/templates)

   **Authentication & authorization**
   - Missing auth checks on new endpoints/routes
   - Hardcoded credentials or tokens
   - Insecure session handling
   - Privilege escalation paths

   **Data exposure**
   - Secrets or API keys in source (check for common patterns: `sk-`, `ghp_`, `xoxb-`, etc.)
   - Sensitive data logged or returned in error messages
   - Overly permissive CORS or CSP settings

   **Dependency & supply chain**
   - New npm/pip/cargo packages added — note any that are obscure or unmaintained
   - `package.json` / lockfile changes that downgrade versions

   **Cryptography**
   - Use of weak algorithms (MD5, SHA1 for passwords, ECB mode, DES)
   - Insecure random number generation for security-sensitive values

3. Produce a report:
   - **Critical** — issues that must be fixed before shipping (exploitable vulnerabilities)
   - **High** — serious issues that should be addressed soon
   - **Medium** — issues that reduce security posture but aren't immediately exploitable
   - **Low / Informational** — best-practice gaps or items to monitor
   - **Clean** — explicitly state if no issues were found in a category

Be precise: quote the exact file path and line number for each finding. Avoid false positives — if something looks suspicious but is safe in context, explain why.
