# Elixir scanner validation

| Repository | Files | Operations | Calls | Resolved | Scan |
| --- | --- | --- | --- | --- | --- |
| A private Phoenix 1.8 API, 2026-11-03 | 211 | 1302 | 12196 | 5115 | 0.24 s |

The scan found one Mix project with its OTP application entry. Cross-file resolved
calls connect 745 file pairs, for example context modules to the repo, permissions and storage.

Not yet qualified on public Phoenix repositories or umbrella projects; that is required before
publishing, following [creating a scanner](../creating-a-plugin.md#validate-across-frameworks).
