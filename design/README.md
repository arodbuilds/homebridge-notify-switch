# Design reference

This folder is the committed copy of the Claude Design master for the settings page (`HANDOFF.md` and the `notify-switch-settings.html` prototype), overwritten by each export so git shows what changed. It is reference only and is not shipped: the npm package, lint and formatting checks all leave it out.

`BUILD-CONTRACT.md` and `BUILD-CONTRACT-DEFINITIONS.md` are the shell's build contract (40 rules with stable ids) and the definitions its rules refer to, exported September 13, 2026; `CONTRACT-AUDIT.md` records, rule by rule, how the shipped settings UI compares.

`HANDOFF.md` is the shell contract for this page, the file the Claude Design system syncs from: the plugin content (page order, sections, fields, copy) with the shell stated as the numbered rules of `BUILD-CONTRACT.md`, each marked with its status from `CONTRACT-AUDIT.md`.
